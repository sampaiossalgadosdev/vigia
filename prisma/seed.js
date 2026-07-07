/**
 * Arquivo: seed.js
 * Responsabilidade: Popular o banco com dados iniciais de desenvolvimento
 * (superadmin, superusuário, 2 tenants completos com usuários, produtos,
 * fornecedores, categorias, movimentações e sugestões).
 * Utilizado por: npx prisma db seed
 * Depende de: @prisma/client, bcrypt
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

/**
 * Gera um CNPJ válido (14 dígitos) a partir de uma base de 12 dígitos,
 * calculando os dois dígitos verificadores.
 */
function gerarCnpj(base12) {
  const calc = (nums, pesos) => {
    const soma = nums.reduce((acc, n, i) => acc + n * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const n = base12.split('').map(Number);
  const d1 = calc(n, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc([...n, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return base12 + String(d1) + String(d2);
}

/**
 * Cria um tenant completo: usuários, categorias, fornecedores,
 * produtos e movimentações de estoque.
 */
async function criarTenant({ nome, cnpjBase, email, regimeTributario, plano, senhaHash, sufixoEan }) {
  const tenant = await prisma.tenant.create({
    data: { nome, cnpj: gerarCnpj(cnpjBase), email, plano, regimeTributario },
  });

  const dominio = email.split('@')[1];
  await prisma.usuario.createMany({
    data: [
      { tenantId: tenant.id, nome: 'Dono ' + nome, email: 'dono@' + dominio, senha: senhaHash, perfil: 'dono' },
      { tenantId: tenant.id, nome: 'Gerente ' + nome, email: 'gerente@' + dominio, senha: senhaHash, perfil: 'gerente' },
      { tenantId: tenant.id, nome: 'Operador ' + nome, email: 'operador@' + dominio, senha: senhaHash, perfil: 'operador' },
    ],
  });

  const categorias = {};
  for (const nomeCat of ['Mercearia', 'Hortifruti', 'Açougue']) {
    categorias[nomeCat] = await prisma.categoria.create({
      data: { tenantId: tenant.id, nome: nomeCat },
    });
  }

  await prisma.fornecedor.createMany({
    data: [
      { tenantId: tenant.id, nome: 'Distribuidora Paraná Alimentos', cnpj: gerarCnpj('4478112300' + sufixoEan), email: 'vendas@dpalimentos.com.br', telefone: '43999110001' },
      { tenantId: tenant.id, nome: 'Atacadão Norte Pioneiro', cnpj: gerarCnpj('5533997700' + sufixoEan), email: 'comercial@atacnp.com.br', telefone: '43999110002' },
    ],
  });

  const produtosBase = [
    ['Arroz Branco Tipo 1 5kg', 'Camil', 'Mercearia', 'UN', '10063011', 27.9, 21.5, 40, 10],
    ['Feijão Carioca 1kg', 'Kicaldo', 'Mercearia', 'UN', '07133399', 8.49, 6.1, 60, 15],
    ['Açúcar Refinado 1kg', 'União', 'Mercearia', 'UN', '17019900', 4.99, 3.6, 80, 20],
    ['Óleo de Soja 900ml', 'Liza', 'Mercearia', 'UN', '15079011', 7.29, 5.8, 72, 24],
    ['Café Torrado e Moído 500g', 'Melitta', 'Mercearia', 'UN', '09012100', 18.9, 14.2, 30, 8],
    ['Macarrão Espaguete 500g', 'Renata', 'Mercearia', 'UN', '19021900', 4.79, 3.2, 90, 20],
    ['Leite Integral UHT 1L', 'Piracanjuba', 'Mercearia', 'L', '04012010', 5.49, 4.1, 120, 36],
    ['Farinha de Trigo 1kg', 'Dona Benta', 'Mercearia', 'UN', '11010010', 5.99, 4.3, 45, 12],
    ['Refrigerante Cola 2L', 'Coca-Cola', 'Mercearia', 'UN', '22021000', 9.99, 7.1, 60, 18],
    ['Detergente Neutro 500ml', 'Ypê', 'Mercearia', 'UN', '34022000', 2.89, 1.9, 100, 24],
    ['Papel Higiênico 12 rolos', 'Neve', 'Mercearia', 'FD', '48181000', 21.9, 16.4, 25, 6],
    ['Sabão em Pó 1kg', 'Omo', 'Mercearia', 'UN', '34022000', 15.9, 11.8, 35, 10],
  ];

  const produtosPeso = [
    ['Banana Nanica kg', null, 'Hortifruti', '08039000', 5.99, 3.2, 42.5, 10, '2001'],
    ['Tomate Longa Vida kg', null, 'Hortifruti', '07020000', 8.49, 5.1, 28.3, 8, '2002'],
    ['Coxão Mole Bovino kg', null, 'Açougue', '02013000', 42.9, 31.5, 18.75, 5, '2003'],
  ];

  const produtos = [];
  let seq = 1;
  for (const [nomeP, marca, cat, unidade, ncm, preco, custo, estoque, minimo] of produtosBase) {
    const ean = '789' + sufixoEan + String(seq).padStart(8, '0');
    produtos.push(
      await prisma.produto.create({
        data: {
          tenantId: tenant.id, ean, nome: nomeP, marca, ncm, unidade,
          preco, custoMedio: custo, estoqueQtd: estoque, estoqueMin: minimo,
          categoriaId: categorias[cat].id,
        },
      })
    );
    seq++;
  }
  for (const [nomeP, marca, cat, ncm, preco, custo, estoque, minimo, plu] of produtosPeso) {
    const ean = '789' + sufixoEan + String(seq).padStart(8, '0');
    produtos.push(
      await prisma.produto.create({
        data: {
          tenantId: tenant.id, ean, nome: nomeP, marca, ncm, unidade: 'KG',
          vendidoPorPeso: true, plu, preco, custoMedio: custo,
          estoqueQtd: estoque, estoqueMin: minimo, categoriaId: categorias[cat].id,
        },
      })
    );
    seq++;
  }

  // Movimentações recentes para dashboard e painel de rede não ficarem vazios
  const hoje = new Date();
  const diasAtras = (d) => new Date(hoje.getTime() - d * 24 * 60 * 60 * 1000);
  const movs = [
    { produto: produtos[0], tipo: 'entrada', quantidade: 40, origem: 'nfe', dias: 12 },
    { produto: produtos[1], tipo: 'saida', quantidade: 6, origem: 'venda', dias: 1 },
    { produto: produtos[4], tipo: 'saida', quantidade: 3, origem: 'venda', dias: 0 },
    { produto: produtos[6], tipo: 'saida', quantidade: 10, origem: 'venda', dias: 3 },
    { produto: produtos[12], tipo: 'saida', quantidade: 4.35, origem: 'venda', dias: 0 },
    { produto: produtos[9], tipo: 'ajuste', quantidade: -2, origem: 'inventario', dias: 5 },
  ];
  for (const m of movs) {
    await prisma.movimentacaoEstoque.create({
      data: {
        tenantId: tenant.id,
        produtoId: m.produto.id,
        tipo: m.tipo,
        quantidade: m.quantidade,
        custoUnit: m.produto.custoMedio,
        origem: m.origem,
        observacao: 'Registro de seed',
        criadoEm: diasAtras(m.dias),
      },
    });
  }

  return tenant;
}

async function main() {
  console.log('Iniciando seed...');
  const senhaAdmin = await bcrypt.hash('Admin@123', 10);
  const senhaRede = await bcrypt.hash('Rede@123', 10);
  const senhaPadrao = await bcrypt.hash('Senha@123', 10);

  const superadmin = await prisma.superadmin.create({
    data: { nome: 'Administrador do Sistema', email: 'admin@sistema.com', senha: senhaAdmin },
  });
  console.log('Superadmin criado:', superadmin.email);

  const tenantSilva = await criarTenant({
    nome: 'Supermercado Silva',
    cnpjBase: '112223330001',
    email: 'contato@silva.com.br',
    regimeTributario: 'simples',
    plano: 'basico',
    senhaHash: senhaPadrao,
    sufixoEan: '11',
  });
  console.log('Tenant criado:', tenantSilva.nome, '-', tenantSilva.cnpj);

  const tenantCosta = await criarTenant({
    nome: 'Supermercado Costa',
    cnpjBase: '114447770001',
    email: 'contato@costa.com.br',
    regimeTributario: 'presumido',
    plano: 'basico',
    senhaHash: senhaPadrao,
    sufixoEan: '22',
  });
  console.log('Tenant criado:', tenantCosta.nome, '-', tenantCosta.cnpj);

  const superusuario = await prisma.superusuario.create({
    data: {
      nome: 'Dono da Rede Exemplo',
      email: 'rede@exemplo.com',
      senha: senhaRede,
      redes: {
        create: [{ tenantId: tenantSilva.id }, { tenantId: tenantCosta.id }],
      },
    },
  });
  console.log('Superusuário criado:', superusuario.email);

  for (const tenant of [tenantSilva, tenantCosta]) {
    await prisma.sugestao.create({
      data: {
        superusuarioId: superusuario.id,
        tenantId: tenant.id,
        titulo: 'Reforçar estoque de café',
        mensagem: 'O giro de café subiu na rede toda. Sugiro reforçar o pedido junto ao fornecedor antes do fim do mês.',
        tipo: 'estoque',
      },
    });
  }
  console.log('Sugestões criadas.');
  console.log('Seed concluído com sucesso.');
}

main()
  .catch((e) => {
    console.error('Erro no seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
