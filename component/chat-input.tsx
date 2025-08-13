import { useState } from "react";

export default function ChatInput({
  status,
  onSubmit,
}: {
  status: "ready" | "submitted" | "streaming" | "error";
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const isDisabled = status === "submitted" || status === "streaming";

  return (
    <div>
      <form
        className="w-full"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() === "" || isDisabled) return;
          onSubmit(text);
          setText("");
        }}
      >
        <input
          className="w-full py-2 px-4 ml-1 border border-gray-300 rounded-full shadow-md bg-purple-50 focus:outline-none focus:ring-2 focus:ring-blue-400 transition disabled:opacity-0 disabled:animate-bounce"
          placeholder="Qualche dubbio sui tuoi rifiuti?"
          disabled={isDisabled}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </form>
    </div>
  );
}
