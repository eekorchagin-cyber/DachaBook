import { useState } from "react";
import { createPortal } from "react-dom";
import { navigate } from "../app/router";
import { GUIDE_SECTIONS } from "../help/guide";
import { HELP } from "../help/texts";

export function HelpButton({ topic }: { topic: string }) {
  const [open, setOpen] = useState(false);
  const help = HELP[topic];
  if (!help) return null;
  return (
    <>
      <button
        type="button"
        className="icon-button"
        aria-label="Помощь"
        onClick={() => setOpen(true)}
      >
        ?
      </button>
      {open &&
        createPortal(
          <div
            className="sheet-backdrop"
            role="presentation"
            onClick={() => setOpen(false)}
          >
            <div
              className="sheet"
              role="dialog"
              aria-modal="true"
              aria-label={`Помощь: ${help.title}`}
              onClick={(event) => event.stopPropagation()}
            >
              <h2>Помощь: {help.title}</h2>
              {help.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              <div className="actions">
                <button
                  type="button"
                  className="button"
                  onClick={() => setOpen(false)}
                >
                  Понятно
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setOpen(false);
                    navigate(
                      `/guide${GUIDE_SECTIONS[topic] ? `?section=${encodeURIComponent(GUIDE_SECTIONS[topic])}` : ""}`,
                    );
                  }}
                >
                  Подробнее в руководстве
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
