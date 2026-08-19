/*
 * config.js — regras, preset e a lógica pura de "nome do espaço → seção".
 *
 * Este arquivo é carregado tanto no popup quanto no content script.
 * Ele NÃO mexe no DOM do Google Chat. Só decide destinos.
 *
 * Expõe tudo em window.L2Chat para os dois lados usarem.
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Preset da L2 — a configuração padrão, aplicável em um clique.
  // A ORDEM importa: vence a primeira regra que casar (por isso [OLD] no topo).
  // "casa": "comeca" (startsWith) ou "contem" (includes).
  // "semCorrespondencia": "perguntar" | "ignorar" | "<nome de uma seção coringa>"
  // ---------------------------------------------------------------------------
  const PRESET_L2 = {
    nome: "L2",
    regras: [
      { casa: "contem", texto: "[OLD]", secao: "📦 OLD" },
      { casa: "comeca", texto: "[L2]", secao: "🏢 L2" },
      { casa: "comeca", texto: "[Gestão]", secao: "🎯 Gestão" },
      { casa: "comeca", texto: "[Salas]", secao: "☕ Salas" },
      { casa: "comeca", texto: "[Happy Hour]", secao: "🍻 Happy Hour" },
      { casa: "comeca", texto: "[Com convidados]", secao: "🏠 Com convidados" },
      { casa: "comeca", texto: "[Projeto]", secao: "🚀 Projeto" },
      { casa: "comeca", texto: "[Unifika]", secao: "🧩 Unifika" },
      { casa: "comeca", texto: "[Núcleo]", secao: "🧠 Núcleo" }
    ],
    // Espaços sem colchete no começo são de convidado/cliente ou reunião do Meet.
    // "perguntar" = mostrar na pré-visualização e deixar a pessoa decidir.
    semCorrespondencia: "perguntar"
  };

  // Configuração vazia, base para quem for montar do zero.
  const CONFIG_VAZIA = { nome: "", regras: [], semCorrespondencia: "perguntar" };

  // ---------------------------------------------------------------------------
  // Regra pura de identificação de convidado (item 2.1 do roteiro):
  //   Tem colchete no começo? É nosso.  Não tem? É de fora (ou é reunião do Meet).
  // ---------------------------------------------------------------------------
  function temPrefixo(nome) {
    return /^\s*\[/.test(nome || "");
  }

  // ---------------------------------------------------------------------------
  // Casa um nome de espaço com a lista ordenada de regras.
  // Retorna { secao } da primeira regra que casar, ou null.
  // ---------------------------------------------------------------------------
  function casarRegra(nome, regras) {
    const n = (nome || "").trim();
    for (const r of regras) {
      const t = (r.texto || "").trim();
      if (!t) continue;
      if (r.casa === "contem" && n.includes(t)) return r;
      if (r.casa === "comeca" && n.startsWith(t)) return r;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Monta o plano: para cada nome de espaço, decide o destino.
  // Retorna:
  //   { nome, secao, motivo }  onde motivo ∈ 'regra' | 'coringa' | 'ignorar' | 'perguntar'
  // Espaços com motivo 'ignorar' não devem ser tocados.
  // Espaços com motivo 'perguntar' precisam de decisão humana (sem colchete).
  // ---------------------------------------------------------------------------
  function planejar(nomes, config) {
    const regras = (config && config.regras) || [];
    const sc = (config && config.semCorrespondencia) || "perguntar";
    return nomes.map(function (nome) {
      const r = casarRegra(nome, regras);
      if (r) return { nome: nome, secao: r.secao, motivo: "regra" };

      // Sem correspondência de regra.
      if (sc === "ignorar") return { nome: nome, secao: null, motivo: "ignorar" };
      if (sc === "perguntar") return { nome: nome, secao: null, motivo: "perguntar" };
      // Qualquer outra string = seção coringa.
      return { nome: nome, secao: sc, motivo: "coringa" };
    });
  }

  // ---------------------------------------------------------------------------
  // Lista de seções distintas que o plano vai precisar criar (na ordem das regras),
  // considerando só destinos de fato usados. Preserva a ordem da configuração.
  // ---------------------------------------------------------------------------
  function secoesNecessarias(plano, config) {
    const usadas = new Set(
      plano.filter((p) => p.secao).map((p) => p.secao)
    );
    const ordem = [];
    // Primeiro na ordem das regras (previsível), depois quaisquer coringas.
    for (const r of (config.regras || [])) {
      if (usadas.has(r.secao) && !ordem.includes(r.secao)) ordem.push(r.secao);
    }
    for (const s of usadas) {
      if (!ordem.includes(s)) ordem.push(s);
    }
    return ordem;
  }

  // ---------------------------------------------------------------------------
  // Validação leve de uma config importada por JSON.
  // Retorna { ok: true, config } ou { ok: false, erro }.
  // ---------------------------------------------------------------------------
  function validarConfig(obj) {
    if (!obj || typeof obj !== "object") return { ok: false, erro: "JSON não é um objeto." };
    if (!Array.isArray(obj.regras)) return { ok: false, erro: 'Falta a lista "regras".' };
    for (let i = 0; i < obj.regras.length; i++) {
      const r = obj.regras[i];
      if (!r || typeof r !== "object") return { ok: false, erro: `Regra ${i + 1} inválida.` };
      if (r.casa !== "comeca" && r.casa !== "contem")
        return { ok: false, erro: `Regra ${i + 1}: "casa" deve ser "comeca" ou "contem".` };
      if (typeof r.texto !== "string" || !r.texto.trim())
        return { ok: false, erro: `Regra ${i + 1}: "texto" vazio.` };
      if (typeof r.secao !== "string" || !r.secao.trim())
        return { ok: false, erro: `Regra ${i + 1}: "secao" vazia.` };
    }
    const sc = obj.semCorrespondencia;
    if (sc !== undefined && typeof sc !== "string")
      return { ok: false, erro: '"semCorrespondencia" deve ser texto.' };
    return {
      ok: true,
      config: {
        nome: typeof obj.nome === "string" ? obj.nome : "",
        regras: obj.regras.map((r) => ({ casa: r.casa, texto: r.texto, secao: r.secao })),
        semCorrespondencia: sc || "perguntar"
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Armazenamento (chrome.storage.local). Guarda a config ativa da pessoa.
  // ---------------------------------------------------------------------------
  const CHAVE = "l2chat_config";

  function carregarConfig() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([CHAVE], (r) => {
          resolve((r && r[CHAVE]) || JSON.parse(JSON.stringify(PRESET_L2)));
        });
      } catch (e) {
        resolve(JSON.parse(JSON.stringify(PRESET_L2)));
      }
    });
  }

  function salvarConfig(config) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set({ [CHAVE]: config }, () => resolve(true));
      } catch (e) {
        resolve(false);
      }
    });
  }

  window.L2Chat = Object.assign(window.L2Chat || {}, {
    PRESET_L2,
    CONFIG_VAZIA,
    temPrefixo,
    casarRegra,
    planejar,
    secoesNecessarias,
    validarConfig,
    carregarConfig,
    salvarConfig
  });
})();
