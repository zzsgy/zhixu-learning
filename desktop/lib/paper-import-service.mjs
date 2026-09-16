/** 任务与占位论文先提交，网络处理可在重启后重新执行。 */
import { getPaperById, markPaperExtractionFailed, updatePaperImportMetadata, updatePaperSourceText, updatePaperCategory } from "./database.mjs";
import { parseArxivIdentity } from "./paper-identity.mjs";
import { fetchArxivPaperByUrl } from "./paper-service.mjs";
import { parseAndClassifyArticle } from "./article-parser.mjs";
import { preparePaperFullText, preparePaperWebSource } from "./paper-fulltext.mjs";
import { classifyDocument } from "./classifier.mjs";
import { triggerCodexPaperTranslationWorker } from "./codex-paper-translator.mjs";
import { asRetryableImportError } from "./import-retry.mjs";

export function createPaperImportHandler(dependencies = {}) {
  const readArxiv = dependencies.fetchArxivPaperByUrl || fetchArxivPaperByUrl;
  const readWeb = dependencies.parseAndClassifyArticle || parseAndClassifyArticle;
  const readFullText = dependencies.preparePaperFullText || preparePaperFullText;
  const classify = dependencies.classifyDocument || classifyDocument;
  const triggerTranslation = dependencies.triggerCodexPaperTranslationWorker || triggerCodexPaperTranslationWorker;
  return async function processPaperImport(job, context) {
    const { paperId, inputUrl, inputKind, force } = job.payload;
    let paper = getPaperById(paperId);
    if (!paper) throw new Error("论文已删除，导入任务已结束。");
    try {
      if (!paper.sourceText?.trim() || force) {
        if (inputKind === "arxiv") {
          context.updateProgress({ stage: "metadata", progressPercent: 8 });
          const identity = parseArxivIdentity(inputUrl);
          const metadata = await readArxiv(inputUrl);
          if (!metadata || !identity) throw new Error("arXiv 未返回该论文的元数据，请核对编号后重试。");
          paper = updatePaperImportMetadata(paperId, { ...metadata, externalId: identity.externalId, sourceUrl: identity.sourceUrl, pdfUrl: identity.pdfUrl });
        }
        context.updateProgress({ stage: "extracting", progressPercent: 30 });
        if (inputKind === "webpage") {
          const article = await readWeb(inputUrl);
          const prepared = preparePaperWebSource(article, article.url || inputUrl);
          updatePaperImportMetadata(paperId, { ...article, authors: article.author ? [article.author] : [], sourceUrl: article.url || inputUrl });
          paper = updatePaperSourceText(paperId, { ...prepared, resetTranslation: Boolean(force) });
        } else paper = await readFullText(paperId, { force: Boolean(force) });
        if (!paper?.sourceText?.trim()) throw new Error(paper?.extractionError || "尚未取得可阅读全文，请重试或导入本地 PDF。");
      }
      context.updateProgress({ stage: "classifying", progressPercent: 90 });
      const classification = await classify({ fileName: paper.title, text: paper.sourceText });
      paper = updatePaperCategory(paper.id, classification.category);
      Promise.resolve().then(() => triggerTranslation()).catch(error => console.warn(`论文已保存，翻译唤醒稍后重试：${error.message}`));
      return { targetType: "paper", targetId: paper.id, title: paper.title, wordCount: paper.sourceTextWordCount };
    } catch (error) {
      const retryableError = asRetryableImportError(error, { maxAttempts: 5 });
      if (getPaperById(paperId)) {
        const willRetry = retryableError && job.retryCount < retryableError.maxAttempts - 1;
        markPaperExtractionFailed(
          paperId,
          willRetry
            ? `${retryableError.message} 系统将自动重试。`
            : retryableError
              ? `${retryableError.message} 已达到自动重试上限，可手动重试。`
              : error.message,
        );
      }
      throw retryableError || error;
    }
  };
}
