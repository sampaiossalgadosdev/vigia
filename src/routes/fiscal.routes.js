/**
 * Arquivo: fiscal.routes.js
 * Responsabilidade: Definir os endpoints /api/fiscal e encadear
 * middlewares (auth, permissão por módulo) e controller.
 * /exportar-xmls usa o módulo "relatorios" — exportação de XML é
 * fundamentalmente um relatório/extração de dados, reaproveita o módulo
 * já existente em vez de criar um novo só pra isso.
 * /certificado usa o módulo dedicado "assinatura_fiscal" com
 * exigeAcessoCompleto (não exigePermissao) — devolve o certificado digital
 * do tenant descriptografado; qualquer nível de leitura menor que
 * acesso_completo não deve conseguir extraí-lo.
 * /chave-assinatura-local NÃO usa exigeAcessoCompleto('assinatura_fiscal')
 * de propósito — diferente do certificado, esta chave não é um segredo
 * fiscal, é só o pareamento de rede local entre vigia-pdv e o app
 * ASSINATURA (ver fiscal.service.buscarOuCriarChaveAssinaturaLocal);
 * qualquer operador de PDV do tenant precisa dela pra vender em
 * contingência, não só quem tem acesso completo.
 */
const { Router } = require('express');
const controller = require('../controllers/fiscal.controller');
const { auth } = require('../middlewares/auth');
const { exigePermissao, exigeAcessoCompleto } = require('../middlewares/permissao.middleware');

const router = Router();
router.use(auth);

const gestao = exigePermissao('relatorios');

router.get('/exportar-xmls', gestao, controller.exportarXmls);
router.get('/certificado', exigeAcessoCompleto('assinatura_fiscal'), controller.buscarCertificado);
router.get('/chave-assinatura-local', controller.buscarChaveAssinaturaLocal);

module.exports = router;
