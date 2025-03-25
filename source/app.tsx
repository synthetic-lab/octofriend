import React, { useState, useCallback, useMemo, useEffect } from "react";
import { Text, Box } from "ink";
import TextInput from "ink-text-input";
import { Config } from "./config.ts";
import OpenAI from "openai";
import figlet from "figlet";
import Spinner from "ink-spinner";

const THEME_COLOR = "#72946d";

type Props = {
	config: Config;
};

type Message = {
	role: "assistant" | "user",
	content: string,
};

export default function App({ config }: Props) {
	const client = useMemo(() => {
		return new OpenAI({
			baseURL: config.baseUrl,
			apiKey: process.env[config.apiEnvVar],
		});
	}, [ config ]);

	const [ history, setHistory ] = useState<Array<Message>>([]);
	const [ query, setQuery ] = useState("");
	const [ responding, setResponding ] = useState(false);

	const onSubmit = useCallback(async () => {
		setQuery("");
		let newHistory = [
			...history,
			{
				role: "user" as const,
				content: query,
			},
		]
		setHistory(newHistory);
		setResponding(true);

		const res = await client.chat.completions.create({
			model: config.model,
			messages: newHistory,
			stream: true,
		});

		newHistory.push({
			role: "assistant" as const,
			content: "",
		});

		for await(const chunk of res) {
			const tokens = chunk.choices[0]?.delta.content || "";
			newHistory = [ ...newHistory ];
			const last = newHistory.pop();
			newHistory.push({
				role: "assistant",
				content: (last?.content || "") + tokens,
			});
			setHistory(newHistory);
		}

		setResponding(false);
	}, [ setQuery, query, config ]);

	return <Box flexDirection="column" width="100%">
		<Header />

		<Text>
			Hello, <Text color="green">World</Text>
		</Text>

		<History history={history} />

		<InputBox
			responding={responding}
			value={query}
			onChange={setQuery}
			onSubmit={onSubmit}
		/>
	</Box>
}

const History = React.memo(({ history }: {
	history: Array<Message>,
}) => {
	return <Box flexDirection="column">
		{
			history.map((item, index) => {
				return <Box
					key={`msg-${index}`}
					marginTop={1}
					marginBottom={1}
				>
					<Text color={item.role === "assistant" ? "white" : "" }>
						{item.role === "user" ? "> " : null}{item.content}
					</Text>
				</Box>
			})
		}
	</Box>
});

const InputBox = React.memo((props: {
	responding: boolean,
	value: string,
	onChange: (s: string) => any,
	onSubmit: () => any,
}) => {
		if(props.responding) return <Loading />;
		return <Box width="100%" borderStyle="round" borderColor={THEME_COLOR}>
			<TextInput value={props.value} onChange={props.onChange} onSubmit={props.onSubmit} />
		</Box>
});

const Header = React.memo(() => {
	const font: figlet.Fonts = "Delta Corps Priest 1";
	const top = figlet.textSync("Octo", font);
	const bottom = figlet.textSync("Friend", font);

	return <Box flexDirection="column">
		<Text color={THEME_COLOR}>{top}</Text>
		<Text>{bottom}</Text>
	</Box>
});

const LOADING_STRINGS = [
	"Scheming",
	"Plotting",
	"Manipulating",
	"Planning",
];
function Loading() {
	const [ idx, setIndex ] = useState(0);
	const [ dotCount, setDotCount ] = useState(0);

	useEffect(() => {
		let fired = false;
		const timer = setTimeout(() => {
			fired = true;
			if(dotCount >= 3) {
				setDotCount(0);
				setIndex((idx + 1) % LOADING_STRINGS.length);
				return;
			}
			setDotCount(dotCount + 1);
		}, 300);

		return () => {
			if(!fired) clearTimeout(timer);
		}
	}, [ idx, dotCount ]);

	return <Box>
		<Text color="gray"><Spinner type="binary" /></Text>
		<Text>{ " " }</Text>
		<Text>{LOADING_STRINGS[idx]} {".".repeat(dotCount)}</Text>
	</Box>
}
