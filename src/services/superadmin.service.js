/**
 * Arquivo: superadmin.service.js
 * Responsabilidade: Regra de negócio do painel do dono do SaaS: login,
 * gestão de tenants (criação com dono opcional, planos, ativar/desativar,
 * stats), gestão de superusuários e vínculos com tenants.
 * Utilizado por: SuperadminController.
 * Depende de: SuperadminRepository, UsuarioRepository, AuditoriaRepository,
 * utils/jwt, utils/bcrypt, utils/cnpj.
 * Não realiza acesso HTTP nem acesso direto ao Prisma.
 */
const forge = require('node-forge');
const superadminRepo = require('../repositories/superadmin.repository');
const usuarioRepo = require('../repositories/usuario.repository');
const auditoriaRepo = require('../repositories/auditoria.repository');
const { gerarAccessToken } = require('../utils/jwt');
const { comparar, gerarHash } = require('../utils/bcrypt');
const { validarCnpj, limparCnpj } = require('../utils/cnpj');
const { criptografar, criptografarTexto } = require('../utils/certcrypto');
const { extrairDoP12 } = require('../utils/certificadoInfo');
const { AppError, paginado } = require('../utils/response');

const PLANOS = ['standard', 'pro'];
const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

/**
 * Remove os campos sensíveis (blobs criptografados) das respostas da API:
 * certificado A1 e os CSCs de homologação/produção. Nunca devolve o
 * conteúdo cifrado, só se ele existe ou não.
 */
function semSegredosFiscais(tenant) {
  if (!tenant) return tenant;
  const { certificadoPfx, certificadoSenha, cscProducao, cscHomologacao, ...resto } = tenant;
  return {
    ...resto,
    temCertificado: !!certificadoPfx,
    temCscProducao: !!cscProducao,
    temCscHomologacao: !!cscHomologacao,
  };
}

async function login(email, senha) {
  const admin = await superadminRepo.buscarAdminPorEmail(email);
  if (!admin || !admin.ativo || !(await comparar(senha, admin.senha)))
    throw new AppError('E-mail ou senha incorretos', 401);
  const accessToken = gerarAccessToken({ sub: admin.id }, 'admin');
  return { accessToken, superadmin: { id: admin.id, nome: admin.nome, email: admin.email } };
}

// ─── Tenants ──────────────────────────────────────────────
async function listarTenants(query, pag) {
  const incluirInativos = query.incluirInativos === 'true';
  const { items, total } = await superadminRepo.listarTenants(
    { ativo: query.ativo, plano: query.plano, incluirInativos },
    { skip: pag.skip, take: pag.limit, search: pag.search }
  );
  return paginado(items.map(semCertificado), total, pag.page, pag.limit);
}

/**
 * Cria um tenant. Se body.dono ({ nome, email, senha }) vier preenchido,
 * cria também o usuário dono inicial.
 */
async function criarTenant(body) {
  const cnpj = limparCnpj(body.cnpj);
  if (!validarCnpj(cnpj)) throw new AppError('CNPJ do tenant inválido', 422);
  if (!body.nome || !body.email) throw new AppError('Nome e e-mail do tenant são obrigatórios', 422);
  const existente = await superadminRepo.buscarTenantPorCnpj(cnpj);
  if (existente) throw new AppError('Já existe um tenant com este CNPJ', 409);

  if (body.plano && !PLANOS.includes(body.plano)) throw new AppError('Plano deve ser standard ou pro', 422);
  // UF obrigatória: precisamos dela pra escolher a URL certa de webservice
  // da SEFAZ por estado na emissão de NFC-e (Fase 1c).
  if (!body.uf) throw new AppError('UF é obrigatória para cadastrar o tenant', 422);
  if (!UFS.includes(String(body.uf).toUpperCase())) throw new AppError('UF inválida', 422);

  const tenant = await superadminRepo.criarTenant({
    nome: body.nome, cnpj, email: body.email, telefone: body.telefone || null,
    uf: String(body.uf).toUpperCase(),
    plano: body.plano || 'standard', regimeTributario: body.regimeTributario || 'simples',
  });

  let dono = null;
  if (body.dono && body.dono.email && body.dono.senha) {
    dono = await usuarioRepo.criar({
      tenantId: tenant.id,
      nome: body.dono.nome || 'Dono ' + tenant.nome,
      email: body.dono.email,
      senha: await gerarHash(body.dono.senha),
      isDono: true,
    });
  }
  await auditoriaRepo.registrar({
    tenantId: tenant.id, acao: 'criar', entidade: 'Tenant', entidadeId: tenant.id,
    depois: { nome: tenant.nome, cnpj: tenant.cnpj, plano: tenant.plano },
  });
  return { tenant: semSegredosFiscais(tenant), dono: dono ? { id: dono.id, email: dono.email } : null };
}

async function atualizarTenant(id, body) {
  const atual = await superadminRepo.buscarTenantPorId(id);
  if (!atual) throw new AppError('Tenant não encontrado', 404);

  const dados = {};
  if (body.nome) dados.nome = body.nome;
  if (body.email) dados.email = body.email;
  if (body.telefone !== undefined) dados.telefone = body.telefone || null;
  if (body.plano) {
    if (!PLANOS.includes(body.plano)) throw new AppError('Plano deve ser standard ou pro', 422);
    dados.plano = body.plano;
  }
  if (body.regimeTributario) dados.regimeTributario = body.regimeTributario;
  if (body.uf !== undefined) {
    if (body.uf && !UFS.includes(String(body.uf).toUpperCase())) throw new AppError('UF inválida', 422);
    dados.uf = body.uf ? String(body.uf).toUpperCase() : null;
  }
  if (body.ativo !== undefined) dados.ativo = body.ativo === true || body.ativo === 'true';
  if (body.cnpj) {
    const cnpj = limparCnpj(body.cnpj);
    if (!validarCnpj(cnpj)) throw new AppError('CNPJ inválido', 422);
    const existente = await superadminRepo.buscarTenantPorCnpj(cnpj);
    if (existente && existente.id !== id) throw new AppError('Já existe um tenant com este CNPJ', 409);
    dados.cnpj = cnpj;
  }
  const tenant = await superadminRepo.atualizarTenant(id, dados);
  await auditoriaRepo.registrar({
    tenantId: id, acao: 'editar', entidade: 'Tenant', entidadeId: id,
    antes: { nome: atual.nome, plano: atual.plano, ativo: atual.ativo },
    depois: { nome: tenant.nome, plano: tenant.plano, ativo: tenant.ativo },
  });
  return semSegredosFiscais(tenant);
}

/**
 * Valida e grava o certificado digital A1 do tenant. O .pfx é aberto em
 * memória com a senha informada (ou sem senha) — se o parse falhar, nada é
 * salvo. Extrai o CNPJ do certificado (convenção e-CNPJ) e rejeita se não
 * bater com o CNPJ já cadastrado do tenant; extrai também a validade,
 * quando o certificado seguir essa convenção. Binário e senha são
 * criptografados (AES-256-GCM) antes de persistir; nenhum dado sensível vai
 * pra Auditoria nem pra logs. Este é o MESMO certificado usado na
 * Distribuição DF-e (NF-e de entrada) — uma empresa tem um único A1 por
 * CNPJ, usado também na futura emissão de NFC-e (Fase 1b/1c).
 */
async function salvarCertificado(id, arquivo, senha) {
  const tenant = await superadminRepo.buscarTenantPorId(id);
  if (!tenant) throw new AppError('Tenant não encontrado', 404);
  if (!arquivo || !arquivo.buffer) throw new AppError('Envie o arquivo .pfx do certificado', 422);

  const senhaCert = senha || '';
  let p12;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(arquivo.buffer.toString('binary')));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, senhaCert);
  } catch (e) {
    throw new AppError('Senha do certificado incorreta ou certificado inválido', 422);
  }

  const { cnpj: cnpjCertificado, validade } = extrairDoP12(p12);
  if (!cnpjCertificado)
    throw new AppError('Não foi possível validar o CNPJ deste certificado — confira manualmente se é o certificado correto antes de prosseguir.', 422);
  if (cnpjCertificado !== tenant.cnpj)
    throw new AppError('O CNPJ do certificado não corresponde ao CNPJ cadastrado deste supermercado', 422);

  const atualizado = await superadminRepo.atualizarTenant(id, {
    certificadoPfx: criptografar(arquivo.buffer),
    certificadoSenha: senhaCert ? criptografarTexto(senhaCert) : null,
    certificadoUploadEm: new Date(),
    certificadoValidade: validade,
  });
  await auditoriaRepo.registrar({
    tenantId: id, acao: 'editar', entidade: 'Tenant', entidadeId: id,
    depois: { certificadoAtualizado: true, arquivo: arquivo.originalname, tamanhoBytes: arquivo.size },
  });
  return { certificadoUploadEm: atualizado.certificadoUploadEm, certificadoValidade: atualizado.certificadoValidade };
}

async function statsTenant(id) {
  const tenant = await superadminRepo.buscarTenantPorId(id);
  if (!tenant) throw new AppError('Tenant não encontrado', 404);
  const stats = await superadminRepo.statsTenant(id);
  return { tenant: { id: tenant.id, nome: tenant.nome, plano: tenant.plano, ativo: tenant.ativo }, stats };
}

async function validarTenantExiste(id) {
  const tenant = await superadminRepo.buscarTenantPorId(id);
  if (!tenant) throw new AppError('Tenant não encontrado', 404);
  return tenant;
}

// ─── Superusuários ────────────────────────────────────────
async function listarSuperusuarios(pag) {
  const { items, total } = await superadminRepo.listarSuperusuarios({
    skip: pag.skip, take: pag.limit, search: pag.search,
  });
  return paginado(items, total, pag.page, pag.limit);
}

async function criarSuperusuario(body) {
  if (!body.nome || !body.email || !body.senha)
    throw new AppError('Nome, e-mail e senha são obrigatórios', 422);
  const existente = await superadminRepo.buscarSuperusuarioPorEmail(body.email);
  if (existente) throw new AppError('Já existe um superusuário com este e-mail', 409);
  const criado = await superadminRepo.criarSuperusuario({
    nome: body.nome, email: body.email, senha: await gerarHash(body.senha),
  });
  const { senha, ...resto } = criado;
  return resto;
}

async function atualizarSuperusuario(id, body) {
  const atual = await superadminRepo.buscarSuperusuarioPorId(id);
  if (!atual) throw new AppError('Superusuário não encontrado', 404);
  const dados = {};
  if (body.nome) dados.nome = body.nome;
  if (body.email) dados.email = body.email;
  if (body.senha) dados.senha = await gerarHash(body.senha);
  if (body.ativo !== undefined) dados.ativo = body.ativo === true || body.ativo === 'true';
  const atualizado = await superadminRepo.atualizarSuperusuario(id, dados);
  const { senha, ...resto } = atualizado;
  return resto;
}

async function atrelarTenants(superusuarioId, tenantIds) {
  const superusuario = await superadminRepo.buscarSuperusuarioPorId(superusuarioId);
  if (!superusuario) throw new AppError('Superusuário não encontrado', 404);
  if (!Array.isArray(tenantIds) || tenantIds.length === 0)
    throw new AppError('Informe tenantIds (array) para atrelar', 422);
  for (const tenantId of tenantIds) await validarTenantExiste(tenantId);
  await superadminRepo.atrelarTenants(superusuarioId, tenantIds);
  return { atrelados: tenantIds.length };
}

async function desatrelarTenant(superusuarioId, tenantId) {
  const resultado = await superadminRepo.desatrelarTenant(superusuarioId, tenantId);
  if (resultado.count === 0) throw new AppError('Vínculo não encontrado', 404);
  return { desatrelado: true };
}

module.exports = {
  login, listarTenants, criarTenant, atualizarTenant, salvarCertificado, statsTenant, validarTenantExiste,
  listarSuperusuarios, criarSuperusuario, atualizarSuperusuario, atrelarTenants, desatrelarTenant,
  semSegredosFiscais,
};
