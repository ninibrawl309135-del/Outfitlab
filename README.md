# Oficina / Camiseta — Estúdio 3D

Editor local em português para personalizar vestuário em 3D no navegador. Inclui cinco malhas comunitárias realistas em GLB — duas camisetas, moletom, polo e camisa xadrez —, seletor de cores, arte enviada pelo usuário, texto, pintura alinhada ao ponteiro/toque, vistas frente/costas/lateral, zoom, cenários e exportação PNG com as duas faces.

## Desenvolvimento

- Requisitos: Node.js 22+ e pnpm 11.
- Instalação: `pnpm install`
- Prévia: `pnpm dev`
- Build estático: `pnpm build`

O editor não requer login, servidor ou banco de dados. As imagens selecionadas são usadas localmente no navegador e não são enviadas ao servidor. Os modelos GLB são servidos localmente a partir de `public/models/`.

## Modelos e atribuição

Os cinco GLBs são modelos da galeria comunitária do MakeIt3D publicados antes de 1º de outubro de 2026. Os termos atuais do serviço preservam para modelos compartilhados antes dessa data a licença CC BY 4.0. Cada fonte, data, link e alteração está documentada em [`public/models/ATTRIBUTION.md`](public/models/ATTRIBUTION.md).
