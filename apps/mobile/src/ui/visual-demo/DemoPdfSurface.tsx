import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { File, Paths } from "expo-file-system";
import { NativePdfSurface } from "../../reader/pdf/NativePdfSurface";
import { readerFixtures } from "../../reader/readerFixtures";
import type { DemoSurfaceHandle } from "./DemoReadingSurface";
import type {
  DemoAnnotation,
  DemoReadingPreferences,
  DemoTextSelection,
} from "./readerSamples";
import { demoColors as c } from "./demoTheme";

/** Reuse the installed native PDF renderer, with an existing two-page local fixture. */
export function DemoPdfSurface({
  ref,
  initialPosition,
  jump,
  preferences,
  annotations,
  onPosition,
  onReady,
  onTap,
  onAnnotation,
  onSelectionAction,
  onAsk,
}: {
  ref?: Ref<DemoSurfaceHandle>;
  initialPosition: number;
  jump: { position: number; revision: number };
  preferences: DemoReadingPreferences;
  annotations: DemoAnnotation[];
  onPosition: (position: number) => void;
  onReady: (count: number) => void;
  onTap: () => void;
  onAnnotation: (id: string) => void;
  onAsk: (quote: string) => void;
  onSelectionAction: (
    kind: "highlight" | "note",
    selection: DemoTextSelection,
  ) => void;
}) {
  const initialPage = useRef(initialPosition + 1);
  const [uri, setUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [command, setCommand] = useState("");
  const sequence = useRef(0);
  const clear = () =>
    setCommand(
      JSON.stringify({ type: "clearSelection", sequence: ++sequence.current }),
    );
  useImperativeHandle(ref, () => ({ clearSelection: clear }));
  useEffect(() => {
    try {
      const sample = new File(Paths.cache, "shudeng-ui-demo.pdf");
      if (!sample.exists)
        sample.write(
          Uint8Array.from(atob(readerFixtures.pdf.base64), (char) =>
            char.charCodeAt(0),
          ),
        );
      setUri(sample.uri);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    setCommand(
      JSON.stringify({
        type: "goTo",
        page: jump.position + 1,
        operationId: "demo-pdf-" + ++sequence.current,
      }),
    );
  }, [jump]);
  const marks = useMemo(
    () =>
      JSON.stringify(
        annotations.flatMap((item) =>
          item.pdf
            ? [
                {
                  id: item.id,
                  kind: item.kind,
                  color:
                    (
                      {
                        "#EAD58A": "yellow",
                        "#BFDBC4": "green",
                        "#BCD6E7": "blue",
                        "#E7BFC7": "rose",
                      } as Record<string, string>
                    )[item.color] ?? "yellow",
                  body: item.body,
                  page: item.pdf.page,
                  rects: item.pdf.rects,
                },
              ]
            : [],
        ),
      ),
    [annotations],
  );
  return (
    <View style={s.root}>
      {uri && NativePdfSurface && (
        <NativePdfSurface
          style={s.root}
          uri={uri}
          page={initialPage.current}
          mode={preferences.pdfFlow}
          dark={false}
          annotations={marks}
          command={command}
          onPdfEvent={({ nativeEvent: event }) => {
            if (event.type === "ready") {
              onReady(event.pageCount);
              setLoading(false);
            } else if (event.type === "page") onPosition(event.page - 1);
            else if (event.type === "tap") onTap();
            else if (event.type === "annotation") onAnnotation(event.id);
            else if (event.type === "error") {
              setError(event.message);
              setLoading(false);
            } else if (event.type === "selectionAction") {
              if (event.action === "highlight" || event.action === "note")
                onSelectionAction(event.action, {
                  quote: event.text,
                  ranges: [
                    {
                      position: event.page - 1,
                      start: 0,
                      end: event.text.length,
                    },
                  ],
                  pdf: { page: event.page, rects: [...event.rects] },
                });
              else {
                if (event.action === "ask") onAsk(event.text);
                clear();
              }
            }
          }}
        />
      )}
      {(!NativePdfSurface || error) && (
        <View style={s.status}>
          <Text style={s.error}>{error || "当前安装包缺少 PDF 阅读组件"}</Text>
        </View>
      )}
      {loading && NativePdfSurface && !error && (
        <View pointerEvents="none" style={s.status}>
          <ActivityIndicator color={c.accent} />
        </View>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.paper },
  status: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  error: { color: c.secondary, fontSize: 16, lineHeight: 26 },
});
