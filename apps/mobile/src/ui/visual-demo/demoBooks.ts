/** Local layout fixtures, including illustrative paraphrases; not a book source. */
export const demoBooks = [
  {
    id: "river",
    format: "EPUB",
    title: "额尔古纳河右岸",
    author: "迟子建",
    progress: 38,
    color: "#344A43",
    ink: "#F6EEDD",
    english: "THE RIGHT BANK",
    chapter: "清晨",
    paragraphs: [
      "我是雨和雪的老熟人了，我有九十岁了。雨雪看老了我，我也把它们给看老了。",
    ],
    question: "为什么从雨和雪开始讲故事？",
    answer:
      "叙述者先说自己与雨雪的关系，再说年龄。开篇让自然成为认识她的入口，也为整本书建立了叙述的尺度。",
  },
  {
    id: "moon",
    format: "EPUB",
    title: "月亮与六便士",
    author: "毛姆",
    progress: 12,
    color: "#B76745",
    ink: "#FFF0DB",
    english: "THE MOON & SIXPENCE",
    chapter: "第一章",
    paragraphs: [
      "老实说，初次见到查尔斯·斯特里克兰的时候，我一点也没看出他有什么特别的地方。",
      "一个人的外表与他的内心之间，往往隔着一段我们无法轻易走过的距离。",
    ],
    question: "为什么主人公起初看起来如此平凡？",
    answer:
      "故事从旁观者的判断开始。平凡的初印象与后来发生的事形成距离，让我们重新思考：对一个人的了解究竟有多少来自表象。",
  },
  {
    id: "walden",
    format: "EPUB",
    title: "瓦尔登湖",
    author: "梭罗",
    progress: 0,
    color: "#E6DFCA",
    ink: "#34483E",
    english: "WALDEN",
    chapter: "我生活的地方",
    paragraphs: [
      "我到树林里去，是因为我希望有目的地生活，只面对生活中最基本的事实，看看我是否能学到生活所要教给我的东西。",
      "我不愿意过一种不真实的生活，因为生活是如此宝贵；我也不愿意屈从于必然，除非万不得已。",
      "我想深入地生活，吸取生活的精髓，过得扎实、简单，把一切不属于生活的东西剔除出去。",
      "让我们从容地度过一天，如同大自然一样，不要让每一片落在轨道上的果壳和蚊子的翅膀把我们抛离轨道。",
    ],
    question: "梭罗说的简朴，是要放弃什么？",
    answer:
      "梭罗希望放下的，是那些消耗生命、却没有使生活更充实的事。简朴让时间重新回到自己手中，而不是把贫乏本身当成目的。",
  },
  {
    id: "siddhartha",
    format: "EPUB",
    title: "悉达多",
    author: "黑塞",
    progress: 0,
    color: "#536575",
    ink: "#F7EDDA",
    english: "SIDDHARTHA",
    chapter: "河边",
    paragraphs: [
      "河水流去，又不断地流来。它始终在这里，却从不是同一条河。",
      "他静静地听着。不急于回答，也不试图用已经知道的道理解释眼前的一切。",
    ],
    question: "河流在故事里意味着什么？",
    answer:
      "河流让变化与延续同时变得可见。悉达多从倾听河水开始，逐渐学会不急于把经验归入既定的答案。",
  },
  {
    id: "pdf",
    format: "PDF",
    title: "PDF 文字样本",
    author: "书灯",
    progress: 0,
    color: "#69594C",
    ink: "#F9EFE2",
    english: "READING NOTES",
    chapter: "第 1 页",
    paragraphs: ["本地 PDF 阅读样本。"],
    question: "这份 PDF 的要点是什么？",
    answer:
      "这里演示 PDF 的问答界面。正式回答需要根据这份文档实际检索到的内容组织依据。",
  },
] as const;
export type DemoBook = (typeof demoBooks)[number];
export function findDemoBook(title = "瓦尔登湖"): DemoBook {
  return demoBooks.find((book) => book.title === title) ?? demoBooks[2];
}
