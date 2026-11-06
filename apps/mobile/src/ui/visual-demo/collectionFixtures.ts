/** Representative local samples, including long titles and records beyond the preview. */
export interface DemoNote {
  id: string;
  bookId: string;
  quote: string;
  location: string;
  date: string;
  thought: string;
  personal?: boolean;
  position?: number;
}
export interface DemoConversation {
  id: string;
  bookId: string;
  title: string;
  date: string;
  count: number;
  selection?: string;
}
export const demoNotes: readonly DemoNote[] = [
  {
    id: "n1",
    bookId: "river",
    quote: "我是雨和雪的老熟人了，我有九十岁了。",
    location: "清晨",
    date: "今天",
    thought: "不是从名字和身份开始，而是从人与自然的关系开始。",
  },
  {
    id: "n2",
    bookId: "river",
    quote: "森林既是家园，也是记忆的容器。",
    location: "阅读随记",
    date: "昨天",
    thought: "下次读的时候，想再看看“离开”这个线索。",
    personal: true,
  },
  {
    id: "n5",
    bookId: "river",
    quote:
      "她说起族人的时候，常常会先说起他们生活的地方。人与地方的关系，是否也在塑造一个人讲述自己的方式？",
    location: "阅读随记",
    date: "11 月 4 日",
    thought: "先记下这个问题，读到后面再回来对照。",
    personal: true,
  },
  {
    id: "n6",
    bookId: "river",
    quote: "关于迁徙：离开一个地方之后，什么会被带走，什么又留在原地？",
    location: "阅读随记",
    date: "11 月 3 日",
    thought: "回看每一次离开之后，人物之间的关系发生了什么变化。",
    personal: true,
  },
  {
    id: "n7",
    bookId: "river",
    quote: "不同的季节，让同一片森林呈现出不同的面貌。",
    location: "阅读随记",
    date: "11 月 2 日",
    thought: "关注时间如何通过景物被写出来。",
    personal: true,
  },
  {
    id: "n8",
    bookId: "river",
    quote: "有些告别没有被郑重地说出来。",
    location: "阅读随记",
    date: "11 月 1 日",
    thought: "叙述里越平静的地方，越值得多读一次。",
    personal: true,
  },
  {
    id: "n9",
    bookId: "river",
    quote: "先把人物关系记清楚，再整理这条故事线。",
    location: "阅读随记",
    date: "10 月 31 日",
    thought: "留意同一个人物在不同叙述中的变化。",
    personal: true,
  },
  {
    id: "n10",
    bookId: "river",
    quote: "回忆的顺序，和事情发生的顺序并不总是一致。",
    location: "阅读随记",
    date: "10 月 30 日",
    thought: "重读开篇的时候，可以试着画一条时间线。",
    personal: true,
  },
  {
    id: "n3",
    bookId: "walden",
    quote: "我想深入地生活，吸取生活的精髓。",
    location: "我生活的地方",
    date: "11 月 3 日",
    thought: "简朴并不只是拥有得少，也是在决定把时间花在哪里。",
  },
  {
    id: "n4",
    bookId: "moon",
    quote: "一个人的自由，是否会成为另一个人的代价？",
    location: "阅读随记",
    date: "11 月 2 日",
    thought: "不急着认同或反对，先看看每一次选择之后发生了什么。",
    personal: true,
  },
];
export const demoConversations: readonly DemoConversation[] = [
  {
    id: "c1",
    bookId: "river",
    title: "为什么从雨和雪开始讲故事？",
    date: "今天",
    count: 8,
  },
  {
    id: "c2",
    bookId: "river",
    title: "森林在这本书里意味着什么",
    date: "昨天",
    count: 6,
  },
  {
    id: "c5",
    bookId: "river",
    title:
      "读到这里，我想知道：为什么叙述者总是先写天气、森林和动物，再慢慢讲到人的经历？这种写法和她对时间、生命以及家园的理解有什么关系？",
    date: "11 月 4 日",
    count: 12,
  },
  {
    id: "c6",
    bookId: "river",
    title: "如何理解故事中的迁徙",
    date: "11 月 3 日",
    count: 4,
  },
  {
    id: "c7",
    bookId: "river",
    title: "叙述者如何看待离别",
    date: "11 月 2 日",
    count: 5,
  },
  {
    id: "c8",
    bookId: "river",
    title: "整理一下开篇的人物关系",
    date: "11 月 1 日",
    count: 10,
  },
  {
    id: "c9",
    bookId: "river",
    title: "季节变化怎样推动故事",
    date: "10 月 31 日",
    count: 3,
  },
  {
    id: "c10",
    bookId: "river",
    title: "记忆中的家园发生了什么变化",
    date: "10 月 30 日",
    count: 7,
  },
  {
    id: "c11",
    bookId: "river",
    title: "回忆与现实的叙述是怎样衔接的",
    date: "10 月 29 日",
    count: 6,
  },
  {
    id: "c12",
    bookId: "river",
    title: "这段描写为什么让我觉得很安静",
    date: "10 月 28 日",
    count: 4,
  },
  {
    id: "c13",
    bookId: "river",
    title: "有没有前后呼应的细节",
    date: "10 月 27 日",
    count: 9,
  },
  {
    id: "c14",
    bookId: "river",
    title: "读完开篇后还有哪些线索可以留意",
    date: "10 月 26 日",
    count: 2,
  },
  {
    id: "c3",
    bookId: "walden",
    title: "梭罗说的简朴，是要放弃什么？",
    date: "11 月 3 日",
    count: 4,
    selection:
      "我到树林里去，是因为我希望有目的地生活，只面对生活中最基本的事实，看看我是否能学到生活所要教给我的东西。我不愿意过一种不真实的生活，因为生活是如此宝贵；我也不愿意屈从于必然，除非万不得已。我想深入地生活，吸取生活的精髓，过得扎实、简单，把一切不属于生活的东西剔除出去。",
  },
  {
    id: "c4",
    bookId: "moon",
    title: "如何看待斯特里克兰的选择",
    date: "11 月 2 日",
    count: 10,
  },
];
