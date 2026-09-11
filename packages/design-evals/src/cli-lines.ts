/**
 * A command's output, as permanent Ink lines.
 *
 * The harness's commands are `main(argv, line)`: they compute, and say what
 * they found one line at a time. This renders those lines with Ink's
 * `<Static>`, so every command prints the same way, and keeps `main` free of
 * any terminal concern — a test hands it an array to push to.
 */
export type Line = (text: string) => void;

export async function runWithInkLines(
  main: (argv: readonly string[], line: Line) => Promise<number>,
  argv: readonly string[]
): Promise<number> {
  const { createElement } = await import('react');
  const { render, Static, Text } = await import('ink');
  const lines: { id: number; text: string }[] = [];
  const view = () =>
    createElement(Static<{ id: number; text: string }>, {
      items: [...lines],
      children: (item) => createElement(Text, { key: item.id }, item.text),
    });
  const app = render(view());
  const line: Line = (text) => {
    lines.push({ id: lines.length, text });
    app.rerender(view());
  };
  try {
    return await main(argv, line);
  } catch (error) {
    // A refusal is an answer, said in the same place as every other line.
    line(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    app.unmount();
  }
}
