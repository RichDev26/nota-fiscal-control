/**
 * Extração de texto de PDF preservando espaços por lacuna horizontal.
 *
 * POR QUE EXISTE: o pdf-parse padrão concatena os itens de texto de uma mesma
 * linha sem separador. Isso funciona na maioria dos PDFs, onde o próprio
 * arquivo traz caracteres de espaço — mas o DANFSe v2.0 posiciona cada palavra
 * como um item independente, sem espaço nenhum. O texto padrão sai assim:
 *
 *     JMINOXMANUTENCAOINDUSTRIALLTDA
 *     14/09/202617:17:25
 *
 * ...o que torna impossível ler nome, endereço, descrição ou separar data de
 * hora. Medindo a lacuna entre o fim de um item e o começo do próximo dá para
 * reinserir o espaço que o PDF não gravou.
 *
 * ESCOPO DELIBERADAMENTE ESTREITO: esta função NÃO substitui a extração padrão
 * do motor. Ela é chamada apenas pelo caminho do DANFSe v2.0. Trocar a extração
 * de todos os documentos mudaria o texto que os parsers já existentes recebem —
 * exatamente o tipo de alteração global que causaria regressão silenciosa nos
 * layouts que hoje funcionam.
 */
import pdfParse from 'pdf-parse';

/** Item de texto do pdf.js: transform = [escalaX, _, _, escalaY, x, y]. */
interface ItemTexto {
  str: string;
  width?: number;
  transform: number[];
}

/**
 * Fração do tamanho da fonte a partir da qual uma lacuna vira espaço.
 * 0.18 foi aferido no modelo DANFSe v2.0: separa palavras sem inserir espaço
 * dentro de palavras (kerning normal fica bem abaixo disso).
 */
const FRACAO_LACUNA = 0.18;
/** Piso absoluto, para fontes muito pequenas onde a fração seria desprezível. */
const LACUNA_MINIMA = 0.8;
/** Diferença de Y a partir da qual se considera outra linha. */
const TOLERANCIA_LINHA = 0.5;

function renderizarComLacunas(pageData: {
  getTextContent: (o: unknown) => Promise<{ items: ItemTexto[] }>;
}): Promise<string> {
  return pageData
    .getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
    .then(({ items }) => {
      let texto = '';
      let ultimoY: number | null = null;
      let ultimoFimX = 0;

      for (const item of items) {
        const x = item.transform[4];
        const y = item.transform[5];
        const largura = item.width ?? 0;
        const tamanhoFonte = item.transform[0] ?? 8;

        if (ultimoY === null) {
          // primeiro item: nada a separar
        } else if (Math.abs(y - ultimoY) > TOLERANCIA_LINHA) {
          texto += '\n';
        } else {
          const lacuna = x - ultimoFimX;
          const limiar = Math.max(LACUNA_MINIMA, tamanhoFonte * FRACAO_LACUNA);
          if (lacuna > limiar) texto += ' ';
        }

        texto += item.str;
        ultimoY = y;
        ultimoFimX = x + largura;
      }
      return texto;
    });
}

/** Texto do PDF com espaços reconstruídos a partir da posição dos itens. */
export async function extrairTextoComLacunas(pdfBuffer: Buffer): Promise<string> {
  const parsed = await pdfParse(pdfBuffer, {
    pagerender: renderizarComLacunas,
  } as Parameters<typeof pdfParse>[1]);
  return parsed.text;
}
