import type { DemoBook } from "./demoBooks";

/** Illustrative chapters, not a parsed EPUB or original quotations. */
const additionalChapters: Record<
  DemoBook["id"],
  { title: string; paragraphs: string[] }[]
> = {
  pdf: [],
  river: [
    {
      title: "正午",
      paragraphs: [
        "太阳升高的时候，营地里慢慢有了声响。人们沿着熟悉的小路走向林间，各自忙着一天的事情。",
        "那些地名与人名，像树木的年轮一样留在记忆里。讲述它们，也是在讲述已经远去的生活。",
      ],
    },
    {
      title: "黄昏",
      paragraphs: [
        "火光映着人们的面孔。白天没有讲完的话，到了夜里又被慢慢拾起来。",
        "河水依旧流过那里。后来的人沿河走去，也许还会认得故事里的那片山林。",
      ],
    },
  ],
  moon: [
    {
      title: "第二章",
      paragraphs: [
        "回忆一个人时，我们总会从后来发生的事情里，替最初的相遇寻找一些征兆。",
        "可在那个普通的下午，谁也没有理由想到，他会选择一条如此不同的路。",
      ],
    },
    {
      title: "第三章",
      paragraphs: [
        "他们谈起绘画，也谈起自己的日常。那些听来琐碎的话，有时比一个郑重的解释更接近真实。",
        "他没有回答，只把目光移向了窗外。生活中有些变化，是旁人很晚才看得出来的。",
      ],
    },
  ],
  walden: [
    {
      title: "孤独",
      paragraphs: [
        "傍晚，我沿着湖边的小路散步。水面上的光一点点暗下来，风穿过树林，带来白天没有听见的声音。",
        "独处并不总意味着寂寞。当生活的节奏慢下来，人才能留意到身边细微而丰富的变化。",
        "屋里的一张桌子、窗外的一片树林，都可以成为日常的陪伴。重要的也许不是拥有多少，而是如何度过眼前的时间。",
      ],
    },
    {
      title: "春天",
      paragraphs: [
        "冰层开始松动，湖面传来轻微的声响。岸边的土地重新露出颜色，冬天仿佛是在不知不觉中离开的。",
        "每一天都有新的迹象。昨天还没有看见的嫩芽，今天已经长在了路旁。",
        "季节让人重新理解等待。许多变化发生得缓慢，却始终没有停下来。",
      ],
    },
  ],
  siddhartha: [
    {
      title: "船夫",
      paragraphs: [
        "船靠岸的时候，他们没有急着说话。对岸的树影落在水里，被船桨轻轻分开。",
        "他开始学习倾听眼前的人。不是准备自己的回答，而是让那些话完整地到达耳边。",
      ],
    },
    {
      title: "圆满",
      paragraphs: [
        "许多曾经分开的声音，渐渐汇成了同一种流动。河水没有停下，他也不再急于给它一个解释。",
        "走过的路并没有消失。它们留在此刻，让一个普通的相遇也有了不同的意义。",
      ],
    },
  ],
};

export function readerSamples(book: DemoBook) {
  return [
    { title: book.chapter, paragraphs: [...book.paragraphs] },
    ...additionalChapters[book.id],
  ].flatMap((chapter, chapterIndex) =>
    chapter.paragraphs.map((text, paragraphIndex) => ({
      id: book.id + ":" + chapterIndex + ":" + paragraphIndex,
      chapter: chapter.title,
      chapterIndex,
      paragraphIndex,
      text,
    })),
  );
}
export type DemoTextSelection = {
  quote: string;
  ranges: { position: number; start: number; end: number }[];
  pdf?: {
    page: number;
    rects: { x: number; y: number; width: number; height: number }[];
  };
};
export type DemoAnnotation = DemoTextSelection & {
  id: string;
  kind: "highlight" | "note";
  color: string;
  body: string;
};
export type DemoReadingState = {
  position: number;
  bookmarks: number[];
  annotations: DemoAnnotation[];
};
export type DemoReadingPreferences = {
  flow: "paginated" | "scrolled";
  pdfFlow: "paginated" | "scrolled";
  fontSize: number;
};
export const defaultReadingState: DemoReadingState = {
  position: 0,
  bookmarks: [],
  annotations: [],
};
export const defaultReadingPreferences: DemoReadingPreferences = {
  flow: "paginated",
  pdfFlow: "scrolled",
  fontSize: 20,
};

export function initialReadingState(book: DemoBook): DemoReadingState {
  if (book.format === "PDF")
    return { position: 0, bookmarks: [], annotations: [] };
  const text = book.paragraphs[0];
  return {
    position: 0,
    bookmarks: [],
    annotations: [
      {
        id: book.id + "-highlight",
        kind: "highlight",
        color: "#EAD58A",
        body: "",
        quote: text.slice(0, 16),
        ranges: [{ position: 0, start: 0, end: 16 }],
      },
      {
        id: book.id + "-note",
        kind: "note",
        color: "#AA7A44",
        body: "下次再读时，留意这里与后文的联系。",
        quote: text.slice(-18),
        ranges: [{ position: 0, start: text.length - 18, end: text.length }],
      },
    ],
  };
}
