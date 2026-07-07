/**
 * Arquivo: auth.service.js
 * Responsabilidade: Regra de negócio de autenticação do contexto tenant:
 * login, refresh com rotação, logout com invalidação real e dados do usuário.
 * Utilizado por: AuthController.
 * Depende de: UsuarioRepository, AuditoriaRepository, utils/jwt, utils/bcrypt.
 * Não realiza acesso HTTP nem acesso direto ao Prisma.
 */
const usuarioRepo = require('../repositories/usuario.repository');
const auditoriaRepo = require('../repositories/auditoria.repository');
const { gerarAccessToken, gerarRefreshToken, verificarRefreshToken } = require('../utils/jwt');
const { comparar, gerarHash } = require('../utils/bcrypt');
const { AppError } = require('../utils/response');

/**
 * Gera o par access + refresh token, persistindo o refresh (hash bcrypt,
 * lookup por jti) no banco.
 */
async function gerarPar(usuario) {
  const accessToken = gerarAccessToken({ sub: usuario.id, tenantId: usuario.tenantId }, 'tenant');
  const { token: refreshToken, jti } = gerarRefreshToken({ sub: usuario.id });
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await usuarioRepo.salvarRefreshToken({
    id: jti,
    tenantId: usuario.tenantId,
    usuarioId: usuario.id,
    tokenHash: await gerarHash(refreshToken),
    expiresAt,
  });
  return { accessToken, refreshToken };
}

/**
 * Monta o mapa { modulo: nivel } a partir do Perfil do usuário (vazio para o Dono).
 */
function mapaPermissoes(usuario) {
  const permissoes = {};
  if (usuario.perfil) for (const p of usuario.perfil.permissoes) permissoes[p.modulo] = p.nivel;
  return permissoes;
}

/**
 * Formato de usuário exposto ao frontend: sem senha, com isDono/perfil/permissões.
 */
function usuarioPublico(usuario) {
  return {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    isDono: usuario.isDono,
    perfilId: usuario.perfilId,
    perfilNome: usuario.isDono ? 'Dono' : usuario.perfil ? usuario.perfil.nome : null,
    permissoes: mapaPermissoes(usuario),
  };
}

/**
 * Autentica por e-mail/senha. Como o e-mail é único apenas por tenant,
 * percorre os usuários ativos com aquele e-mail até a senha conferir.
 */
async function login(email, senha, ip) {
  const candidatos = await usuarioRepo.buscarPorEmailGlobal(email);
  for (const usuario of candidatos) {
    const confere = await comparar(senha, usuario.senha);
    if (!confere) continue;
    if (!usuario.tenant.ativo)
      throw new AppError('Conta suspensa. Entre em contato com o suporte.', 403);
    const tokens = await gerarPar(usuario);
    await auditoriaRepo.registrar({
      tenantId: usuario.tenantId, usuarioId: usuario.id, acao: 'login', entidade: 'Usuario', entidadeId: usuario.id, ip,
    });
    return {
      ...tokens,
      usuario: {
        ...usuarioPublico(usuario),
        tenant: { id: usuario.tenant.id, nome: usuario.tenant.nome, plano: usuario.tenant.plano },
      },
    };
  }
  throw new AppError('E-mail ou senha incorretos', 401);
}

/**
 * Renova o par de tokens com rotação: o refresh antigo é apagado do banco
 * e um novo é gerado. Refresh ausente no banco = revogado → 401.
 */
async function refresh(refreshToken) {
  let decoded;
  try {
    decoded = verificarRefreshToken(refreshToken);
  } catch (e) {
    throw new AppError('Refresh token inválido ou expirado', 401);
  }
  const registro = await usuarioRepo.buscarRefreshToken(decoded.jti);
  if (!registro) throw new AppError('Refresh token revogado', 401);
  const confere = await comparar(refreshToken, registro.token);
  if (!confere) throw new AppError('Refresh token inválido', 401);
  if (registro.expiresAt < new Date()) {
    await usuarioRepo.deletarRefreshToken(decoded.jti);
    throw new AppError('Refresh token expirado', 401);
  }

  const usuario = await usuarioRepo.buscarPorId(registro.tenantId, registro.usuarioId);
  if (!usuario || !usuario.ativo) throw new AppError('Usuário inválido ou inativo', 401);

  await usuarioRepo.deletarRefreshToken(decoded.jti); // rotação
  const tokens = await gerarPar(usuario);
  return {
    ...tokens,
    usuario: {
      ...usuarioPublico(usuario),
      tenant: { id: usuario.tenant.id, nome: usuario.tenant.nome, plano: usuario.tenant.plano },
    },
  };
}

/**
 * Invalida o refresh token no banco (logout real).
 */
async function logout(refreshToken, usuario, ip) {
  try {
    const decoded = verificarRefreshToken(refreshToken);
    await usuarioRepo.deletarRefreshToken(decoded.jti);
  } catch (e) {
    // token já inválido/expirado: nada a fazer
  }
  if (usuario)
    await auditoriaRepo.registrar({
      tenantId: usuario.tenantId, usuarioId: usuario.id, acao: 'logout', entidade: 'Usuario', entidadeId: usuario.id, ip,
    });
  return { deslogado: true };
}

module.exports = { login, refresh, logout };
