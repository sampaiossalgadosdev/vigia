/**
 * Arquivo: acougue-carnes.js
 * Responsabilidade: Catálogo padrão do açougue — subgrupos da categoria
 * "Açougue" e as carnes de cada um (8 por subgrupo), com NCM, preços e PLU
 * fixos. Todos são vendidos por peso (KG). O EAN interno é derivado do PLU
 * (prefixo 2, padrão de produto pesado), então o catálogo é determinístico
 * e pode ser aplicado mais de uma vez sem duplicar.
 * Utilizado por: prisma/seed.js (banco novo) e scripts/seed-acougue.js
 * (banco já existente).
 */

// [nome, ncm, precoKg, custoKg, estoqueKg, estoqueMinKg, plu]
const SUBGRUPOS_ACOUGUE = [
  {
    nome: 'Bovinos',
    carnes: [
      ['Picanha', '02013000', 69.9, 52.4, 22.5, 5, '2101'],
      ['Contra Filé', '02013000', 49.9, 37.2, 30.0, 8, '2102'],
      ['Alcatra', '02013000', 44.9, 33.5, 28.0, 8, '2103'],
      ['Coxão Duro', '02013000', 34.9, 25.8, 25.0, 6, '2104'],
      ['Patinho', '02013000', 36.9, 27.4, 26.0, 6, '2105'],
      ['Acém', '02012000', 27.9, 20.3, 32.0, 8, '2106'],
      ['Músculo Bovino', '02012000', 29.9, 21.9, 24.0, 6, '2107'],
      ['Costela Bovina', '02022000', 24.9, 17.8, 40.0, 10, '2108'],
    ],
  },
  {
    nome: 'Suínos',
    carnes: [
      ['Pernil Suíno', '02031900', 19.9, 14.2, 30.0, 8, '2201'],
      ['Costelinha Suína', '02031900', 26.9, 19.6, 28.0, 8, '2202'],
      ['Lombo Suíno', '02031900', 22.9, 16.5, 25.0, 6, '2203'],
      ['Bisteca Suína', '02031900', 18.9, 13.4, 26.0, 6, '2204'],
      ['Panceta Suína', '02031900', 24.9, 18.1, 18.0, 5, '2205'],
      ['Filé Mignon Suíno', '02031900', 29.9, 21.8, 15.0, 4, '2206'],
      ['Copa Lombo Suíno', '02031900', 27.9, 20.2, 16.0, 4, '2207'],
      ['Joelho de Porco', '02031900', 16.9, 11.9, 12.0, 3, '2208'],
    ],
  },
  {
    nome: 'Aves',
    carnes: [
      ['Frango Inteiro', '02071100', 12.9, 9.1, 60.0, 15, '2301'],
      ['Peito de Frango', '02071300', 19.9, 14.3, 45.0, 12, '2302'],
      ['Filé de Peito de Frango', '02071300', 24.9, 18.2, 35.0, 10, '2303'],
      ['Coxa e Sobrecoxa', '02071300', 14.9, 10.4, 50.0, 12, '2304'],
      ['Asa de Frango', '02071300', 21.9, 15.9, 30.0, 8, '2305'],
      ['Frango a Passarinho', '02071300', 15.9, 11.2, 28.0, 8, '2306'],
      ['Coração de Frango', '02071400', 34.9, 25.6, 15.0, 4, '2307'],
      ['Moela de Frango', '02071400', 13.9, 9.7, 14.0, 4, '2308'],
    ],
  },
  {
    nome: 'Peixes e Frutos do Mar',
    carnes: [
      ['Filé de Tilápia', '03043100', 49.9, 36.8, 20.0, 5, '2401'],
      ['Tilápia Inteira', '03027100', 27.9, 20.1, 25.0, 6, '2402'],
      ['Posta de Salmão', '03044100', 89.9, 67.5, 12.0, 3, '2403'],
      ['Filé de Merluza', '03047400', 39.9, 29.4, 18.0, 5, '2404'],
      ['Sardinha Fresca', '03024300', 19.9, 14.1, 22.0, 6, '2405'],
      ['Pescada Branca', '03028900', 32.9, 24.2, 16.0, 4, '2406'],
      ['Posta de Cação', '03028100', 44.9, 33.1, 14.0, 4, '2407'],
      ['Camarão Cinza', '03061700', 69.9, 52.3, 10.0, 3, '2408'],
    ],
  },
  {
    nome: 'Embutidos e Linguiças',
    carnes: [
      ['Linguiça Toscana', '16010000', 21.9, 15.7, 35.0, 10, '2501'],
      ['Linguiça Calabresa', '16010000', 27.9, 20.3, 30.0, 8, '2502'],
      ['Linguiça de Frango', '16010000', 18.9, 13.5, 25.0, 6, '2503'],
      ['Linguiça de Pernil', '16010000', 25.9, 18.8, 22.0, 6, '2504'],
      ['Bacon em Manta', '02101100', 34.9, 25.4, 18.0, 5, '2505'],
      ['Salsicha', '16010000', 12.9, 9.0, 30.0, 8, '2506'],
      ['Mortadela', '16010000', 19.9, 14.2, 20.0, 5, '2507'],
      ['Salame Italiano', '16010000', 59.9, 44.6, 10.0, 3, '2508'],
    ],
  },
];

/** EAN interno de produto pesado: prefixo 2 + PLU, completado com zeros (13 dígitos). */
function eanDoPlu(plu) {
  return ('2' + plu).padEnd(13, '0');
}

module.exports = { SUBGRUPOS_ACOUGUE, eanDoPlu };
