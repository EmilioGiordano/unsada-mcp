import { clean, type FileLink, fileLinks, integerParam, load, mainRegion, richText, safeHref } from "./html.js";
import { dateOrText } from "./values.js";

export interface DiscussionSummary {
    id?: number;
    title: string;
    author: string;
    replies: number;
    lastPost?: string;
    url?: string;
}

export interface Forum {
    title: string;
    description?: string;
    discussions: DiscussionSummary[];
    page: number;
    hasMorePages?: true;
}

export interface Post {
    id?: number;
    subject: string;
    author: string;
    date?: string;
    text: string;
    attachments: FileLink[];
}

export interface Discussion {
    title: string;
    posts: Post[];
}

export function parseForum(html: string, page: number): Forum {
    const $ = load(html);
    const main = mainRegion($);
    const discussions = main
        .find("table.forumheaderlist tr.discussion")
        .toArray()
        .map((row): DiscussionSummary => {
            const topic = $(row).find("td.topic a").first();
            const url = safeHref(topic.attr("href"));
            return {
                id: integerParam(url, "d"),
                title: clean(topic.text()),
                author: clean($(row).find("td.author").text()),
                replies: Number(clean($(row).find("td.replies").text())) || 0,
                lastPost: dateOrText(clean($(row).find("td.lastpost a").last().text())),
                url,
            };
        });
    const hasNextPage = main
        .find(".paging a[href]")
        .toArray()
        .some((anchor) => integerParam($(anchor).attr("href"), "page") === page + 1);
    return {
        title: clean(main.find("h2").first().text()),
        description: richText($, main.find("#intro").first()) || undefined,
        discussions,
        page,
        hasMorePages: hasNextPage || undefined,
    };
}

export function parseDiscussion(html: string): Discussion {
    const $ = load(html);
    const main = mainRegion($);
    const posts = main
        .find("div.forumpost")
        .toArray()
        .map((element): Post => {
            const post = $(element);
            const [author = "", ...date] = clean(post.find(".author").first().text())
                .replace(/^de\s+/, "")
                .split(" - ");
            const anchor = post.prevAll("a[id^=p]").first().attr("id");
            return {
                id: anchor && /^p\d{1,10}$/.test(anchor) ? Number(anchor.slice(1)) : undefined,
                subject: clean(post.find(".subject").first().text()),
                author,
                date: dateOrText(date.join(" - ")),
                text: richText($, post.find(".posting").first()),
                attachments: fileLinks($, post.find(".attachments, .attachedimages")),
            };
        });
    return { title: clean(main.find("h3.discussionname").first().text()), posts };
}
