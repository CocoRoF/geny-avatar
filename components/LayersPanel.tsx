"use client";

import { useEffect, useMemo } from "react";
import { DecomposeStudio } from "@/components/DecomposeStudio";
import { GeneratePanel } from "@/components/GeneratePanel";
import type { AvatarAdapter } from "@/lib/adapters/AvatarAdapter";
import type { Layer, LayerId } from "@/lib/avatar/types";
import { useLayerThumbnail } from "@/lib/avatar/useLayerThumbnail";
import { selectLayers, useEditorStore } from "@/lib/store/editor";

type Props = {
  /** Adapter held by the parent page. Used to read texture page bitmaps
   *  for layer thumbnails. */
  adapter: AvatarAdapter | null;
  /** Stable identifier for the currently-loaded puppet — IDB PuppetId
   *  for uploaded puppets, `"builtin:${sampleKey}"` for built-in samples,
   *  or `null` when no IDB binding exists yet (e.g. /poc/upload before
   *  autoSave completes). When null, AI job history isn't persisted. */
  puppetKey: string | null;
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
export function LayersPanel({ adapter, puppetKey, onToggleLayer, onBulkSet }: Props) {
  const layers = useEditorStore(selectLayers);
  const visibility = useEditorStore((s) => s.visibilityOverrides);
  const filter = useEditorStore((s) => s.layerFilter);
  const setFilter = useEditorStore((s) => s.setLayerFilter);
  const studioLayerId = useEditorStore((s) => s.studioLayerId);
  const setStudioLayer = useEditorStore((s) => s.setStudioLayer);
  const generateLayerId = useEditorStore((s) => s.generateLayerId);
  const setGenerateLayer = useEditorStore((s) => s.setGenerateLayer);
  const layerMasks = useEditorStore((s) => s.layerMasks);
  const layerTextureOverrides = useEditorStore((s) => s.layerTextureOverrides);
  const studioLayer = studioLayerId ? (layers.find((l) => l.id === studioLayerId) ?? null) : null;
  const generateLayer = generateLayerId
    ? (layers.find((l) => l.id === generateLayerId) ?? null)
    : null;

  // Push masks + AI texture overrides into the runtime whenever either
  // changes. Single source of truth: store → this effect → adapter →
  // GPU. The adapter rebuilds each affected page from pristine, so we
  // can pass the whole map every time without worrying about diff.
  useEffect(() => {
    if (!adapter) return;
    let cancelled = false;
    adapter.setLayerOverrides({ masks: layerMasks, textures: layerTextureOverrides }).catch((e) => {
      if (!cancelled) console.warn("[LayersPanel] setLayerOverrides failed", e);
    });
    return () => {
      cancelled = true;
    };
  }, [adapter, layerMasks, layerTextureOverrides]);

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
              hasMask={!!layerMasks[layer.id]}
              hasGenerated={!!layerTextureOverrides[layer.id]}
              onToggle={() => onToggleLayer(layer.id, !visible)}
              onOpenStudio={() => setStudioLayer(layer.id)}
              onOpenGenerate={() => setGenerateLayer(layer.id)}
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

      {studioLayer && <DecomposeStudio adapter={adapter} layer={studioLayer} />}
      {generateLayer && (
        <GeneratePanel adapter={adapter} layer={generateLayer} puppetKey={puppetKey} />
      )}
    </div>
  );
}

type LayerRowProps = {
  adapter: AvatarAdapter | null;
  layer: Layer;
  index: number;
  visible: boolean;
  hasMask: boolean;
  hasGenerated: boolean;
  onToggle: () => void;
  onOpenStudio: () => void;
  onOpenGenerate: () => void;
};

function LayerRow({
  adapter,
  layer,
  index,
  visible,
  hasMask,
  hasGenerated,
  onToggle,
  onOpenStudio,
  onOpenGenerate,
}: LayerRowProps) {
  const thumbUrl = useLayerThumbnail(adapter, layer);
  const canDecompose = !!layer.texture;
  return (
    <li className="group flex items-center gap-1 pr-1">
      <button
        type="button"
        onClick={onToggle}
        className="flex flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--color-panel)]"
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
        {(hasMask || hasGenerated) && (
          <span className="ml-auto flex shrink-0 gap-1">
            {hasGenerated && (
              <span
                className="rounded border border-[var(--color-accent)] px-1 font-mono text-[10px] text-[var(--color-accent)]"
                title="this layer has an AI-generated texture applied"
              >
                gen
              </span>
            )}
            {hasMask && (
              <span
                className="rounded border border-[var(--color-accent)] px-1 font-mono text-[10px] text-[var(--color-accent)]"
                title="this layer has a refined mask saved"
              >
                mask
              </span>
            )}
          </span>
        )}
      </button>
      {canDecompose && (
        <>
          <button
            type="button"
            onClick={onOpenStudio}
            title="open in DecomposeStudio"
            aria-label={`decompose ${layer.name}`}
            className="shrink-0 rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-fg-dim)] opacity-0 transition-opacity hover:text-[var(--color-fg)] group-hover:opacity-100"
          >
            edit
          </button>
          <button
            type="button"
            onClick={onOpenGenerate}
            title="open in GeneratePanel (AI texture)"
            aria-label={`generate ${layer.name}`}
            className="shrink-0 rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-fg-dim)] opacity-0 transition-opacity hover:text-[var(--color-accent)] group-hover:opacity-100"
          >
            gen
          </button>
        </>
      )}
    </li>
  );
}
