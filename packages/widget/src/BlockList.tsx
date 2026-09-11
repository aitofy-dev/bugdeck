/**
 * The report as one document: paragraphs the user types and the pictures
 * between them, in the order they were made.
 *
 * Consecutive images are laid out as a grid rather than one per row — a
 * three-screenshot report is a contact sheet, not three pages — while the flat
 * block order that goes on the wire is untouched.
 */
import { useEffect, useRef, type ChangeEvent } from 'react';
import type { EditorBlock, ImageBlock, TextBlock } from './blocks.js';
import { Icon } from './icons.js';
import { useWidgetStrings } from './strings-context.js';
import type { PendingImage } from './use-pending-images.js';

export type BlockRun =
  | { kind: 'text'; block: TextBlock }
  | { kind: 'images'; blocks: ImageBlock[] };

/** Pure: neighbouring images become one run, everything else stays where it is. */
export function groupBlocks(blocks: readonly EditorBlock[]): BlockRun[] {
  const runs: BlockRun[] = [];
  for (const block of blocks) {
    if (block.kind === 'text') {
      runs.push({ kind: 'text', block });
      continue;
    }
    const last = runs[runs.length - 1];
    if (last?.kind === 'images') last.blocks.push(block);
    else runs.push({ kind: 'images', blocks: [block] });
  }
  return runs;
}

interface AutoGrowProps {
  value: string;
  placeholder: string;
  autoFocus: boolean;
  onFocus: () => void;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
}

/** A borderless paragraph that grows with what is typed — no scrollbar inside a block. */
function AutoGrowTextarea({ value, ...rest }: AutoGrowProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }, [value]);
  return <textarea ref={ref} className="bd-text" rows={1} value={value} {...rest} />;
}

export interface BlockListProps {
  blocks: EditorBlock[];
  images: Map<string, PendingImage>;
  onTextChange: (id: string, text: string) => void;
  onFocusBlock: (id: string) => void;
  onRemoveBlock: (id: string) => void;
  onAnnotate: (imageKey: string) => void;
}

export function BlockList(props: BlockListProps) {
  const strings = useWidgetStrings();
  const last = props.blocks[props.blocks.length - 1];

  return (
    <>
      {groupBlocks(props.blocks).map((run) =>
        run.kind === 'text' ? (
          <AutoGrowTextarea
            key={run.block.id}
            value={run.block.text}
            autoFocus={run.block.id === last?.id}
            placeholder={run.block.id === props.blocks[0]?.id ? strings.descriptionPlaceholder : ''}
            onFocus={() => props.onFocusBlock(run.block.id)}
            onChange={(event) => props.onTextChange(run.block.id, event.target.value)}
          />
        ) : (
          <div className="bd-shots" key={run.blocks[0]?.id}>
            {run.blocks.map((block) => {
              const image = props.images.get(block.imageKey);
              return (
                <figure className="bd-shot" key={block.id}>
                  <img src={image?.previewUrl} alt={image?.file.name ?? strings.imageAlt} />
                  <figcaption className="bd-shot-actions">
                    <button
                      type="button"
                      className="bd-shot-act"
                      aria-label={strings.annotateImage}
                      onClick={() => props.onAnnotate(block.imageKey)}
                    >
                      <Icon name="pen" />
                      {strings.annotate}
                    </button>
                    <button
                      type="button"
                      className="bd-shot-act bd-shot-act--danger"
                      aria-label={strings.removeImage}
                      onClick={() => props.onRemoveBlock(block.id)}
                    >
                      <Icon name="trash" />
                      {strings.remove}
                    </button>
                  </figcaption>
                </figure>
              );
            })}
          </div>
        ),
      )}
    </>
  );
}
