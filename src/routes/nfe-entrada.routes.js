/**
 * Arquivo: nfe-entrada.routes.js
 * Responsabilidade: Definir os endpoints /api/nfe-entrada (consulta SEFAZ,
 * importação de notas, histórico e matching de itens) e encadear middlewares.
 * Faz parte do módulo "estoque" pra fins de permissão. Nenhuma lógica aqui.
 */
const { Router } = require('express');
const controller = require('../controllers/nfeEntrada.controller');
const { auth } = require('../middlewares/auth');
const { exigePermissao } = require('../middlewares/permissao.middleware');

const router = Router();
router.use(auth);

const gestao = exigePermissao('estoque');

router.post('/consultar-sefaz', gestao, controller.consultarSefaz);
router.post('/importar', gestao, controller.importar);
router.get('/historico', gestao, controller.historico);
// Autocomplete do matching fica sob a permissão de estoque (quem faz o
// matching pode não ter o módulo produtos liberado).
router.get('/produtos/busca', gestao, controller.buscarProdutos);
router.get('/:nfeId/itens', gestao, controller.itens);
router.put('/:nfeId/itens/:itemId/vincular', gestao, controller.vincular);

module.exports = router;
