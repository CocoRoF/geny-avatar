"use client";

import { useMemo } from "react";
import type { AvatarAdapter } from "@/lib/adapters/AvatarAdapter";
import type { Layer, LayerId } from "@/lib/avatar/types";
import { useLayerThumbnail } from "@/lib/avatar/useLayerThumbnail";
import { selectLayers, useEditorStore } from "@/lib/store/editor";

type Props = {
  /** Adapter held by the parent page. Used to read texture page bitmaps
   *  for layer thumbnails. */
  adapter: AvatarAdapter | null;
  /** Called when the user clicks a layer row. Caller is responsible for
   *  updating the store and the adapter together. */
  onToggleLayer: (id: LayerId, nextVisible: boolean) => void;
  /** Called when show-all / hide-all is clicked, with the currently
   *  filtered subset's IDs. */
  onBulkSet: (ids: ReadonlyArray<LayerId>, visible: boolean) => void;
};

/**
 * Right-panel layer list. Reads avatar layers + the visibility override
 * map from the store; reports clicks back through the parent so the page
 * can mirror the change to the adapter.
 */
export function LayersPanel({ adapter, onToggleLayer, onBulkSet }: Props) {
  const layers = useEditorStore(selectLayers);
  const visibility = useEditorStore((s) => s.visibilityOverrides);
  const filter = useEditorStore((s) => s.layerFilter);
  const setFilter = useEditorStore((s) => s.setLayerFilter);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return layers;
    return layers.filter((l) => l.name.toLowerCase().includes(f));
  }, [layers, filter]);

  const filteredIds = useMemo(() => filtered.map((l) => l.id), [filtered]);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="shrink-0 border-b border-[var(--color-border)] px-4 py-3">
        <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-widest text-[var(--color-fg-dim)]">
          <span>
            Layers ({filtered.length}/{layers.length})
          </span>
        </div>
        <input
          type="text"
          placeholder="search layer…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-accent)] focus:outline-none"
        />
        <div className="mt-2 flex gap-1 text-xs">
          <button
            type="button"
            onClick={() => onBulkSet(filteredIds, true)}
            className="rounded border border-[var(--color-border)] px-2 py-1 text-[var(--color-fg-dim)] hover:border-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
          >
            show all
          </button>
          <button
            type="button"
            onClick={() => onBulkSet(filteredIds, false)}
            className="rounded border border-[var(--color-border)] px-2 py-1 text-[var(--color-fg-dim)] hover:border-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
          >
            hide all
          </button>
        </div>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {filtered.map((layer, i) => {
          const visible = visibility[layer.id] ?? layer.defaults.visible;
          return (
            <LayerRow
              key={layer.id}
              adapter={adapter}
              layer={layer}
              index={i}
              visible={visible}
              onToggle={() => onToggleLayer(layer.id, !visible)}
            />
          );
        })}
        {filtered.length === 0 && layers.length > 0 && (
          <li className="px-2 py-4 text-center text-xs text-[var(--color-fg-dim)]">no match</li>
        )}
        {layers.length === 0 && (
          <li className="px-2 py-4 text-center text-xs text-[var(--color-fg-dim)]">no layers</li>
        )}
      </ul>
    </div>
  );
}

type LayerRowProps = {
  adapter: AvatarAdapter | null;
  layer: Layer;
  index: number;
  visible: boolean;
  onToggle: () => void;
};

function LayerRow({ adapter, layer, index, visible, onToggle }: LayerRowProps) {
  const thumbUrl = useLayerThumbnail(adapter, layer);
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--color-panel)]"
      >
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            visible ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]"
          }`}
        />
        {thumbUrl ? (
          // biome-ignore lint/performance/noImgElement: blob URLs aren't compatible with next/image optimization
          <img
            src={thumbUrl}
            alt=""
            className="h-7 w-7 shrink-0 rounded border border-[var(--color-border)] bg-[var(--color-bg)] object-contain"
          />
        ) : (
          <span className="h-7 w-7 shrink-0 rounded border border-dashed border-[var(--color-border)] bg-[var(--color-bg)]" />
        )}
        <span className="font-mono text-xs text-[var(--color-fg-dim)]">
          {String(index).padStart(2, "0")}
        </span>
        <span className="truncate">{layer.name}</span>
      </button>
    </li>
  );
}
