/**
 * 知序网页端入口。
 *
 * 页面本身可以匿名打开并展示登录入口；
 * 所有私人数据都由受保护的 /api 路由读取和写入。
 */
import type { Metadata } from "next";
import { Dashboard } from "@/app/dashboard";

/** 页面级 SEO 与浏览器标题配置。 */
export const metadata: Metadata = {
  title: "知序｜技术知识卡片",
  description:
    "在电脑与 Android 间同步 AI、生物制药、洁净工艺和 PostgreSQL 技术学习。",
};

/** 渲染知序单页应用。 */
export default function Home(): React.ReactNode {
  return <Dashboard />;
}
