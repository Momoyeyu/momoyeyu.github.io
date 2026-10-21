export const mascotStates = [
	{
		id: "welcome",
		label: "抱着书，拘谨地打招呼的小鞠知花",
		image: "/img/resources/mascot/novel/welcome.webp",
		messages: ["你、你好……这里可以坐。", "你慢慢看……我、我也看一会儿书。", "不、不用管我……看文章就好。"],
	},
	{
		id: "reading",
		label: "捧着小说，专心阅读的小鞠知花",
		image: "/img/resources/mascot/novel/reading.webp",
		messages: ["再、再一页……看完这页就停。", "这段……写得真好。", "你也……看到这里了吗？"],
	},
	{
		id: "writing",
		label: "拿着笔，在笔记本上写作的小鞠知花",
		image: "/img/resources/mascot/novel/writing.webp",
		messages: ["等、等一下……这句话还没写好。", "这里换个词……会不会更好？", "还、还没写完……先别看。"],
	},
	{
		id: "phone",
		label: "低头用手机打字的小鞠知花",
		image: "/img/resources/mascot/novel/phone.webp",
		messages: ["说、说不出来……我打字给你看。", "发过去了……你、你看一下。", "用文字……就能好好说了。"],
	},
	{
		id: "startled",
		label: "被叫到名字，抱紧书本的小鞠知花",
		image: "/img/resources/mascot/novel/startled.webp",
		messages: ["呜……怎、怎么突然叫我。", "别、别突然凑过来……吓到了。", "有、有事的话……慢慢说。"],
	},
	{
		id: "happy",
		label: "聊到喜欢的书，露出笑容的小鞠知花",
		image: "/img/resources/mascot/novel/happy.webp",
		messages: ["这、这本我也读过……！", "你也喜欢这一段？……我也是。", "下、下次……还可以一起看书。"],
	},
];

export type MascotState = (typeof mascotStates)[number];
