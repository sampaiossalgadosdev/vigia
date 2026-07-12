/**
 * Teste estrutural (Tarefa 2) -- @nfewizard/nfce, com o certificado dummy
 * autoassinado (src/tests/fixtures/certificado-teste.pfx, senha senha123).
 * Usa useForSchemaValidation: 'validateSchemaJsBased' pra evitar a
 * dependência de JDK (documentada no próprio README como alternativa).
 */
const path = require('path');

async function main() {
  const { NFCEWizard } = require('@nfewizard/nfce');
  const nfceWizard = new NFCEWizard();

  console.log('--- PASSO 1: NFE_LoadEnvironment com o certificado dummy (.pfx + senha) ---');
  try {
    await nfceWizard.NFE_LoadEnvironment({
      config: {
        dfe: {
          armazenarXMLAutorizacao: false,
          armazenarXMLRetorno: false,
          armazenarXMLConsulta: false,
          pathCertificado: path.join(__dirname, '..', '..', 'src', 'tests', 'fixtures', 'certificado-teste.pfx'),
          senhaCertificado: 'senha123',
          UF: 'PR',
          CPFCNPJ: '12345678000199',
        },
        nfce: {
          ambiente: 2, // homologação
          versaoDF: '4.00',
          idCSC: 1,
          tokenCSC: '99999999-9999-9999-9999-999999999999',
        },
        lib: {
          connection: { timeout: 15000 },
          log: { exibirLogNoConsole: true, armazenarLogs: false },
          useForSchemaValidation: 'validateSchemaJsBased', // evita exigir JDK
        },
      },
    });
    console.log('OK: certificado carregado, ambiente inicializado sem erro (sem JDK).');
  } catch (e) {
    console.log('FALHOU no LoadEnvironment:', e.message);
    console.log(e.stack ? e.stack.slice(0, 1000) : '');
    return;
  }

  console.log('\n--- PASSO 2: tentar autorizar uma NFC-e mínima (estrutura de teste) contra a SEFAZ-PR de homologação ---');
  console.log('(Chamada de rede real a ambiente de HOMOLOGAÇÃO -- esperado falhar por certificado não confiável/dados incompletos, não é bug.)');
  try {
    const nfceMinima = {
      infNFe: {
        versao: '4.00',
        ide: {
          cUF: 41, natOp: 'VENDA', mod: 65, serie: 1, nNF: 1,
          dhEmi: new Date().toISOString(), tpNF: 1, idDest: 1,
          cMunFG: 4106902, tpImp: 4, tpEmis: 1, tpAmb: 2,
          finNFe: 1, indFinal: 1, indPres: 1, procEmi: 0, verProc: 'TESTE 1.0',
        },
        emit: {
          CNPJ: '12345678000199', xNome: 'EMPRESA TESTE DUMMY LTDA',
          enderEmit: { xLgr: 'Rua Teste', nro: '100', xBairro: 'Centro', cMun: 4106902, xMun: 'Curitiba', UF: 'PR', CEP: '80000000' },
          CRT: 3,
        },
        det: [{
          nItem: 1,
          prod: { cProd: '1', cEAN: 'SEM GTIN', xProd: 'PRODUTO TESTE', NCM: '10063011', CFOP: 5102, uCom: 'UN', qCom: '1.0000', vUnCom: '20.00', vProd: '20.00', cEANTrib: 'SEM GTIN', uTrib: 'UN', qTrib: '1.0000', vUnTrib: '20.00', indTot: 1 },
        }],
        total: { ICMSTot: { vProd: '20.00', vNF: '20.00' } },
        pag: { detPag: [{ tPag: '01', vPag: '20.00' }] },
      },
    };

    const resultado = await nfceWizard.NFCE_Autorizacao(nfceMinima);
    console.log('Resposta recebida (sem exceção de rede):');
    console.log(require('util').inspect(resultado, { depth: 5 }).slice(0, 2500));
  } catch (e) {
    console.log('FALHOU (exceção) ao autorizar:', e.message);
    console.log(e.stack ? e.stack.slice(0, 1500) : '');
  }
}

main();
