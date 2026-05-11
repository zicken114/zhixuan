/**
 * Citation formatting utilities.
 * Supports: 'apa', 'ieee', 'gb7714'.
 */

export interface CitationItem {
  creators?: string;
  date?: string;
  title?: string;
  publication?: string;
  doi?: string;
}

export function formatCitation(
  item: CitationItem,
  style: 'apa' | 'ieee' | 'gb7714' = 'gb7714',
  index?: number
): string {
  const authors = item.creators || 'Unknown';
  const year = item.date ? item.date.split('-')[0] : 'n.d.';
  const title = item.title || 'Untitled';
  const pub = item.publication || '';
  const doi = item.doi || '';

  switch (style) {
    case 'apa':
      return `${authors} (${year}). ${title}. ${pub}${doi ? ` https://doi.org/${doi}` : ''}`;
    case 'ieee': {
      const idx = index ?? 1;
      return `[${idx}] ${authors}, "${title}," ${pub}, ${year}.`;
    }
    case 'gb7714':
    default:
      return `${authors}. ${title}[J]. ${pub}, ${year}.${doi ? ` DOI:${doi}.` : ''}`;
  }
}
