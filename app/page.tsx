"use client";

import { useChat } from "@ai-sdk/react";
import ChatInput from "@/component/chat-input";
import React, { useRef } from "react";
import { RiRobot3Fill } from "react-icons/ri";
import useSmoothScrollToBottom from "@/hooks/useSmoothScrollToBottom";

// Tipi aggiornati per seguire la documentazione ai-sdk
type TextPart = { type: "text"; text: string };
type Role = "user" | "assistant" | "system" | "tool";

interface UIMessage {
  id: string;
  role: Role;
  parts: TextPart[];
}

function extractText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export default function Chat() {
  const { error, status, sendMessage, messages, regenerate, stop } = useChat();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useSmoothScrollToBottom(messages, status);
  return (
    <div
      className={`w-screen ${messages.length === 0 ? "overflow-y-hidden" : ""}`}
    >
      <div className="flex flex-col w-[55%] mx-auto stretch pb-16">
        {messages.map((msg) => {
          // Cast del messaggio per usare parts
          const uiMessage = msg as UIMessage;
          const text = extractText(uiMessage);

          return (
            <div
              ref={scrollRef}
              key={uiMessage.id}
              className={`mb-3 whitespace-pre-wrap text-sm leading-relaxed
            ${
              uiMessage.role === "user"
                ? "ml-auto bg-pink-200 rounded-2xl shadow-sm px-4 py-2 max-w-[70%] text-right"
                : "mr-auto bg-green-50 rounded-2xl px-4 py-2 text-left min-w-full border-l border-purple-300"
            }`}
            >
              <strong>
                {uiMessage.role === "user" ? (
                  ""
                ) : (
                  <div className="relative inline">
                    <div className="inline-flex relative top-2 bg-slate-50 ">
                      <RiRobot3Fill className=" absolute -left-14 -top-8 text-4xl border-2 border-green-50 rounded-full p-1" />
                    </div>
                  </div>
                )}
              </strong>
              {""}
              {text}
            </div>
          );
        })}

        {(status === "submitted" || status === "streaming") && (
          <div className="relative flex items-center gap-3 mt-2 text-sm text-gray-500">
            {status === "submitted" && <span>Elaborazione...</span>}
            {status === "streaming" && <span>Risposta in arrivo...</span>}
            <button
              type="button"
              className="px-3 py-1 text-sm text-black border border-red-500 rounded-full hover:border-purple-50 hover:bg-black hover:text-purple-50"
              onClick={stop}
            >
              Stop
            </button>
          </div>
        )}

        {error && (
          <div className="relative mt-4 text-sm">
            <div className="mb-2 text-red-500">
              Si è verificato un errore: {error.message}
            </div>
            <button
              type="button"
              className="px-3 py-1 text-blue-500 border border-blue-500 rounded-md"
              onClick={() => regenerate()}
            >
              Riprova
            </button>
          </div>
        )}
        <div
          className={`${
            messages.length === 0
              ? "flex my-[50%] items-center justify-center flex-1"
              : "pb-2 fixed bottom-2 w-[55%]"
          }`}
        >
          <div
            className={messages.length === 0 ? "w-full max-w-2xl" : "w-full"}
          >
            <ChatInput
              status={status}
              onSubmit={(text) =>
                sendMessage({
                  text,
                })
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
