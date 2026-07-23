/**
 * 知序网页端全局布局。
 */
import type { Metadata } from "next";
import "./globals.css";

/** 全站元数据配置。 */
export const metadata: Metadata = {
  title: "知序｜技术知识卡片",
  description: "手机接收卡片，电脑深入学习，同一账号自动同步。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

/** 根布局参数。 */
type RootLayoutProps = Readonly<{
  /** 当前路由渲染内容。 */
  children: React.ReactNode;
}>;

/** 提供中文语言环境和全站样式。 */
export default function RootLayout({
  children,
}: RootLayoutProps): React.ReactNode {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
