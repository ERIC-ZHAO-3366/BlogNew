import type { Cheerio, CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import type { LinkPreview, MediaFile, Reply, TelegramPost } from "@/types";
import dayjs from "./dayjs-setup";

const STATIC_PROXY =
  (import.meta as any)?.env?.STATIC_PROXY ||
  (typeof process !== "undefined" ? (process as any)?.env?.STATIC_PROXY : undefined) ||
  "https://cdn5.telesco.pe";
//暂时未找到贴纸在哪里替换，先留着
const STICKER_PROXY =
  (import.meta as any)?.env?.STICKER_PROXY ||
  (typeof process !== "undefined" ? (process as any)?.env?.STICKER_PROXY : undefined) ||
  "telegram.org";
function parseImages(item: Cheerio<Element>, $: CheerioAPI): MediaFile[] {
  return item.find(".tgme_widget_message_photo_wrap").map((_, photo) => {
    const rawUrl = $(photo).attr("style")?.match(/url\(["'](.*?)["']/)?.[1];
    // 用正则提取 /file/ 及其后面的内容
    const filePath = rawUrl?.match(/\/file\/.+/i)?.[0];
    const url = filePath ? `${STATIC_PROXY}${filePath}` : undefined;
    return url ? { type: "image", url } : null;
  }).get().filter(Boolean) as MediaFile[];
}

function parseVideos(item: Cheerio<Element>, $: CheerioAPI): MediaFile[] {
  const videos: MediaFile[] = [];
  item.find(".tgme_widget_message_video_wrap video").each((_, video) => {
    const src = $(video).attr("src");
    if (src) {
      const filePath = src.match(/\/file\/.+/i)?.[0];
      const url = filePath ? `${STATIC_PROXY}${filePath}` : src;

      const poster = $(video).attr("poster") || undefined;
      const thumbPath = poster?.match(/\/file\/.+/i)?.[0];
      const thumbnail = poster ? (thumbPath ? `${STATIC_PROXY}${thumbPath}` : poster) : undefined;

      videos.push({
        type: "video",
        url,
        thumbnail,
      });
    }
  });
  return videos;
}

function parseLinkPreview(item: Cheerio<Element>, $: CheerioAPI): LinkPreview | undefined {
  const link = item.find(".tgme_widget_message_link_preview");
  const url = link.attr("href");
  if (!url)
    return undefined;

  const title = link.find(".link_preview_title").text() || link.find(".link_preview_site_name").text();
  const description = link.find(".link_preview_description").text();
  const imageSrc = link.find(".link_preview_image")?.attr("style")?.match(/url\(["'](.*?)["']/i)?.[1];

  try {
    const hostname = new URL(url).hostname;
    return { url, title, description, image: imageSrc, hostname };
  }
  catch {
    return undefined;
  }
}
function parseReply(item: Cheerio<Element>, $: CheerioAPI, channel: string): Reply | undefined {
  const reply = item.find(".tgme_widget_message_reply");
  if (reply.length === 0)
    return undefined;

  const href = reply.attr("href");
  if (!href)
    return undefined;

  const id = href.split("/").pop() || "";
  const author = reply.find(".tgme_widget_message_author_name").text() || "未知用户";

  let text = reply.text().replace(author, "").trim();

  if (!text) {
    if (reply.find(".tgme_widget_message_photo").length > 0)
      text = "[图片]";
    else if (reply.find(".tgme_widget_message_sticker").length > 0)
      text = "[贴纸]";
    else if (reply.find(".tgme_widget_message_video").length > 0)
      text = "[视频]";
    else text = "...";
  }

  return {
    url: `/post/${id}`,
    author,
    text,
  };
}

/**
 * @returns 返回一个格式化后的 HTML 字符串，如果没有则返回空字符串
 */
function parseUnsupportedMedia(item: Cheerio<Element>, $: CheerioAPI, postLink: string): string {
  const unsupportedWrap = item.find(".message_media_not_supported_wrap");
  if (unsupportedWrap.length === 0)
    return "";

  const label = "媒体文件过大";

  return `
      <div class="unsupported-media-notice not-prose my-2 p-3 bg-base-300/30 border border-base-content/10 rounded-lg flex items-center justify-between gap-2 text-sm">
        <div class="flex items-center gap-2">
          <i class="ri-error-warning-line text-warning"></i>
          <span>${label}，无法预览。</span>
        </div>
        <a href="${postLink}" target="_blank" rel="noopener noreferrer" class="btn btn-xs btn-ghost">
          在 Telegram 中查看
          <i class="ri-external-link-line"></i>
        </a>
      </div>
    `;
}

export function parsePost(element: Element, $: CheerioAPI, channel: string): TelegramPost {
  const item = $(element);
  const id = item.attr("data-post")?.replace(`${channel}/`, "") || "0";
  const postLink = `https://t.me/${channel}/${id}`;

  const datetime = item.find(".tgme_widget_message_date time")?.attr("datetime") || "";
  const formattedDate = datetime ? dayjs(datetime).tz("Asia/Shanghai").fromNow() : "未知时间";

  const textElement = item.find(".tgme_widget_message_text").clone();

  textElement.find("a").each((_, el) => {
    const link = $(el);
    if (link.text().startsWith("#")) {
      link.addClass("hashtag");
    }
    else {
      link.addClass("link link-primary");
    }
  });

  textElement.find(".tgme_widget_message_photo_wrap, .tgme_widget_message_video_wrap").remove();

  // 将 textElement 中 class="emoji" 的元素内 telegram.org 替换为 STICKER_PROXY（回退 STATIC_PROXY）
  textElement.find(".emoji").each((_, el) => {
    const $el = $(el);
    const proxy = STICKER_PROXY || 'telegram.org';

    // 替换 style 中的 URL（例如 background-image:url('//telegram.org/..')）
    const style = $el.attr("style");
    if (style && style.includes("telegram.org")) {
      const newStyle = style.replace(/(\/\/|https?:\/\/)?telegram\.org/gi, (_m, prefix) => {
        if (/^\/\//.test(proxy) || /^https?:\/\//i.test(proxy)) {
          // 若 proxy 含协议或是协议相对，直接使用 proxy（保留形式）
          if (prefix && prefix.startsWith("//") && /^\/\//.test(proxy)) return proxy;
          return proxy;
        }
        // proxy 不含协议：若原来是协议相对则保留 //，否则使用 https://
        if (prefix && prefix.startsWith("//")) return `//${proxy}`;
        return `https://${proxy}`;
      });
      $el.attr("style", newStyle);
    }
  });
  const unsupportedMediaHtml = parseUnsupportedMedia(item, $, postLink);


  return {
    id,
    datetime,
    formattedDate,
    text: item.find(".tgme_widget_message_text").text() || "",
    htmlContent: (textElement.html() || "") + unsupportedMediaHtml,
    views: item.find(".tgme_widget_message_views").text() || "0",
    media: [...parseImages(item, $), ...parseVideos(item, $)],
    linkPreview: parseLinkPreview(item, $),
    reply: parseReply(item, $, channel),
  };
}
