import { html, nothing, svg, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import type { GraphGeometry, GraphLaneRow, MergeNodeMarker } from '../protocol';
import { laneX, rowPaths } from '../protocol';
import * as l10n from '@vscode/l10n';

const laneColor = (color: number): string => `var(--graph-lane-${color})`;

/**
 * The lanes of one row of the graph: the edges that pass through, the commit's node, a ring when it is HEAD,
 * and for a merge the plus or minus that expands or collapses it.
 */
export function rowSvgTemplate(
  row: GraphLaneRow,
  geometry: GraphGeometry,
  height: number,
  isHead: boolean,
  marker: MergeNodeMarker = 'none',
  onToggleMerge: (event: Event) => void = () => undefined,
): TemplateResult {
  const cx = laneX(geometry, row.column);
  const cy = height / 2;
  const color = laneColor(row.color);
  const hollow = row.isMerge || marker !== 'none';
  const arm = 2;
  return html`
    <svg class="graph-svg" width=${geometry.width} height=${height}>
      ${rowPaths(row, geometry, height).map((path) => svg`<path class="graph-edge" d=${path.d} style=${styleMap({ stroke: laneColor(path.color) })}></path>`)}
      ${isHead ? svg`<circle class="graph-head-ring" cx=${cx} cy=${cy} r="5.5" style=${styleMap({ stroke: color })}></circle>` : nothing}
      <circle class=${hollow ? 'graph-node-merge' : 'graph-node'} cx=${cx} cy=${cy} r="3.5"
        style=${styleMap(hollow ? { stroke: color } : { stroke: color, fill: color })}></circle>
      ${marker === 'none' ? nothing : svg`
        <circle class="graph-merge-hit" cx=${cx} cy=${cy} r="8" @click=${onToggleMerge}>
          <title>${marker === 'collapsed' ? l10n.t('Expand merge') : l10n.t('Collapse merge')}</title>
        </circle>
        <path class="graph-merge-mark" style=${styleMap({ stroke: color })}
          d=${marker === 'collapsed' ? `M${cx - arm} ${cy}H${cx + arm}M${cx} ${cy - arm}V${cy + arm}` : `M${cx - arm} ${cy}H${cx + arm}`}></path>`}
    </svg>`;
}
