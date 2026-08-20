"""Generate a searchable Chinese study PDF from local audio and sampled video frames."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path
from xml.sax.saxutils import escape

from faster_whisper import WhisperModel
from PIL import Image, ImageChops, ImageStat
from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image as PdfImage,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio")
    parser.add_argument("--transcript-json")
    parser.add_argument("--frames", required=True)
    parser.add_argument("--frame-interval", type=float, required=True)
    parser.add_argument("--metadata", required=True)
    parser.add_argument("--output-pdf", required=True)
    parser.add_argument("--output-json", required=True)
    parser.add_argument("--model", default="small")
    parser.add_argument("--tesseract", default="tesseract")
    parser.add_argument("--ocr-languages", default="chi_sim+eng")
    parser.add_argument("--max-frames", type=int, default=60)
    return parser.parse_args()


def timestamp(seconds: float) -> str:
    total = max(int(seconds), 0)
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def transcribe(audio_path: Path, model_name: str) -> tuple[list[dict], str]:
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    generated, info = model.transcribe(
        str(audio_path),
        beam_size=5,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
    )
    segments = []
    for item in generated:
        text = re.sub(r"\s+", " ", item.text or "").strip()
        if not text:
            continue
        segments.append({
            "startSeconds": round(float(item.start), 3),
            "endSeconds": round(float(item.end), 3),
            "text": text,
        })
    return segments, str(getattr(info, "language", "") or "")


def load_transcript(transcript_path: Path) -> tuple[list[dict], str]:
    payload = json.loads(transcript_path.read_text(encoding="utf-8"))
    segments = []
    for item in payload.get("segments", []):
        text = re.sub(r"\s+", " ", str(item.get("text") or "")).strip()
        if not text:
            continue
        segments.append({
            "startSeconds": max(float(item.get("startSeconds") or 0), 0),
            "endSeconds": max(float(item.get("endSeconds") or 0), 0),
            "text": text,
        })
    return segments, str(payload.get("language") or "")


def image_difference(left: Path, right: Path) -> float:
    with Image.open(left) as left_image, Image.open(right) as right_image:
        left_gray = left_image.convert("L").resize((64, 36))
        right_gray = right_image.convert("L").resize((64, 36))
        difference = ImageChops.difference(left_gray, right_gray)
        return float(ImageStat.Stat(difference).mean[0])


def select_key_frames(frame_paths: list[Path], interval: float, maximum: int) -> list[dict]:
    if not frame_paths:
        return []
    selected = [{"path": frame_paths[0], "seconds": 0.0}]
    previous = frame_paths[0]
    for index, frame_path in enumerate(frame_paths[1:], start=1):
        seconds = index * interval
        difference = image_difference(previous, frame_path)
        elapsed = seconds - selected[-1]["seconds"]
        if difference >= 9.0 or elapsed >= 32.0:
            selected.append({"path": frame_path, "seconds": seconds})
            previous = frame_path
    last_seconds = (len(frame_paths) - 1) * interval
    if selected[-1]["path"] != frame_paths[-1] and last_seconds - selected[-1]["seconds"] >= interval:
        selected.append({"path": frame_paths[-1], "seconds": last_seconds})
    if len(selected) <= maximum:
        return selected
    step = (len(selected) - 1) / max(maximum - 1, 1)
    indexes = sorted({min(round(position * step), len(selected) - 1) for position in range(maximum)})
    return [selected[index] for index in indexes]


def recognize_frame(frame_path: Path, tesseract: str, languages: str) -> str:
    process = subprocess.run(
        [tesseract, str(frame_path), "stdout", "-l", languages, "--psm", "6"],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=60,
    )
    if process.returncode != 0:
        return ""
    lines = []
    for line in process.stdout.splitlines():
        normalized = re.sub(r"\s+", " ", line).strip()
        if len(normalized) >= 2 and normalized not in lines:
            lines.append(normalized)
    return "\n".join(lines)[:1800]


def transcript_for_window(segments: list[dict], start: float, end: float) -> str:
    texts = []
    for segment in segments:
        if segment["endSeconds"] < start or segment["startSeconds"] >= end:
            continue
        if not texts or texts[-1] != segment["text"]:
            texts.append(segment["text"])
    return " ".join(texts)


def register_fonts() -> tuple[str, str]:
    candidates = [
        (Path(r"C:\Windows\Fonts\Deng.ttf"), Path(r"C:\Windows\Fonts\Dengb.ttf")),
        (Path(r"C:\Windows\Fonts\msyh.ttc"), Path(r"C:\Windows\Fonts\msyhbd.ttc")),
    ]
    for regular, bold in candidates:
        if regular.exists() and bold.exists():
            pdfmetrics.registerFont(TTFont("ZhixuSans", str(regular)))
            pdfmetrics.registerFont(TTFont("ZhixuSansBold", str(bold)))
            return "ZhixuSans", "ZhixuSansBold"
    raise RuntimeError("未找到可用于 PDF 的中文字体。")


def build_pdf(metadata: dict, segments: list[dict], frames: list[dict], output_path: Path) -> int:
    regular_font, bold_font = register_fonts()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    document = SimpleDocTemplate(
        str(output_path),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title=str(metadata.get("title") or "视频图文学习笔记"),
        author="知序本地知识库",
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "ZhixuTitle", parent=styles["Title"], fontName=bold_font,
        fontSize=24, leading=32, textColor=colors.HexColor("#12343B"),
        alignment=TA_LEFT, spaceAfter=10 * mm,
    )
    subtitle_style = ParagraphStyle(
        "ZhixuSubtitle", parent=styles["Heading2"], fontName=bold_font,
        fontSize=15, leading=21, textColor=colors.HexColor("#0B6E75"), spaceAfter=5 * mm,
    )
    body_style = ParagraphStyle(
        "ZhixuBody", parent=styles["BodyText"], fontName=regular_font,
        fontSize=10.5, leading=17, textColor=colors.HexColor("#24383D"),
        alignment=TA_LEFT, wordWrap="CJK", spaceAfter=4 * mm,
    )
    small_style = ParagraphStyle(
        "ZhixuSmall", parent=body_style, fontSize=8.5, leading=13,
        textColor=colors.HexColor("#66787C"),
    )
    center_style = ParagraphStyle(
        "ZhixuCenter", parent=small_style, alignment=TA_CENTER,
    )
    story = [
        Paragraph(escape(str(metadata.get("title") or "视频图文学习笔记")), title_style),
        Paragraph("知序 · 视频时间轴图文学习笔记", subtitle_style),
        Paragraph(
            f"作者：{escape(str(metadata.get('author') or '未知'))}<br/>"
            f"时长：{timestamp(float(metadata.get('durationSeconds') or 0))}<br/>"
            f"来源：<link href=\"{escape(str(metadata.get('canonicalUrl') or ''))}\">"
            f"{escape(str(metadata.get('canonicalUrl') or ''))}</link>",
            body_style,
        ),
        Spacer(1, 8 * mm),
        Paragraph(
            "本 PDF 由本机语音转写、画面变化筛选和 OCR 生成。"
            "文字可搜索；关键画面用于保留 PPT、流程图和操作演示上下文。"
            "自动识别可能存在错误，请结合原视频时间戳核对。",
            body_style,
        ),
        PageBreak(),
    ]
    for index, frame in enumerate(frames):
        start = float(frame["seconds"])
        next_start = float(frames[index + 1]["seconds"]) if index + 1 < len(frames) else start + 32
        end = max(min(next_start, start + 45), start + 8)
        frame_transcript = transcript_for_window(segments, start, end)
        story.append(Paragraph(f"{timestamp(start)} · 关键画面 {index + 1}", subtitle_style))
        image = PdfImage(str(frame["path"]))
        max_width = A4[0] - 36 * mm
        max_height = 118 * mm
        scale = min(max_width / image.imageWidth, max_height / image.imageHeight)
        image.drawWidth = image.imageWidth * scale
        image.drawHeight = image.imageHeight * scale
        story.extend([image, Spacer(1, 3 * mm)])
        if frame.get("ocrText"):
            story.append(Paragraph("画面文字（OCR）", small_style))
            story.append(Paragraph(escape(frame["ocrText"]).replace("\n", "<br/>"), small_style))
        story.append(Paragraph("对应讲解", small_style))
        story.append(Paragraph(
            escape(frame_transcript or "该时间段未识别到清晰语音。"),
            body_style,
        ))
        source_url = str(metadata.get("canonicalUrl") or "")
        separator = "&" if "?" in source_url else "?"
        timed_url = f"{source_url}{separator}t={int(start)}"
        story.append(Paragraph(
            f"<link href=\"{escape(timed_url)}\">返回原视频 {timestamp(start)}</link>",
            center_style,
        ))
        if index + 1 < len(frames):
            story.append(PageBreak())
    document.build(story)
    reader = PdfReader(str(output_path))
    if not reader.pages:
        raise RuntimeError("PDF 没有生成页面。")
    extracted = "\n".join((page.extract_text() or "") for page in reader.pages[:3])
    if str(metadata.get("title") or "")[:8] not in extracted:
        raise RuntimeError("PDF 文字层校验失败。")
    return len(reader.pages)


def main() -> None:
    args = parse_args()
    frame_directory = Path(args.frames).resolve()
    output_pdf = Path(args.output_pdf).resolve()
    output_json = Path(args.output_json).resolve()
    metadata = json.loads(Path(args.metadata).read_text(encoding="utf-8"))
    if args.transcript_json:
        segments, detected_language = load_transcript(Path(args.transcript_json).resolve())
    elif args.audio:
        segments, detected_language = transcribe(Path(args.audio).resolve(), args.model)
    else:
        raise ValueError("必须提供音频或已有字幕。")
    frame_paths = sorted(frame_directory.glob("frame-*.jpg"))
    key_frames = select_key_frames(frame_paths, args.frame_interval, max(args.max_frames, 1))
    for frame in key_frames:
        frame["ocrText"] = recognize_frame(frame["path"], args.tesseract, args.ocr_languages)
    page_count = build_pdf(metadata, segments, key_frames, output_pdf)
    result = {
        "segments": segments,
        "detectedLanguage": detected_language,
        "keyFrameCount": len(key_frames),
        "pageCount": page_count,
        "ocrFrameCount": sum(1 for frame in key_frames if frame.get("ocrText")),
    }
    output_json.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
