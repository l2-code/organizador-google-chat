/*
 * content.js — o motor. Roda dentro da página do Google Chat.
 *
 * Reproduz os 4 passos do roteiro manual:
 *   1. Ordenar alfabeticamente (temporário)
 *   2. Criar as seções que faltam
 *   3. Arrastar cada espaço para a sua seção
 *   4. Voltar para "mais recentes"
 *
 * Princípios (do brief):
 *   - Ancorar em aria-label / role / texto visível. NUNCA em classe gerada.
 *   - Idempotente: não cria seção duplicada nem move o que já está no lugar.
 *   - Falhar de forma VISÍVEL. Melhor dizer "não consegui" do que errar em silêncio.
 *   - Só mexe em seção e posição. Nada de renomear, sair, postar, notificar.
 */
(function () {
  "use strict";

  if (window.__l2chatCarregado) return; // evita dupla injeção
  window.__l2chatCarregado = true;

  const L2 = window.L2Chat;

  // ---------------------------------------------------------------------------
  // Textos de menu, em PT e EN (a conta pode estar em qualquer idioma).
  // ---------------------------------------------------------------------------
  const TXT = {
    espacos: ["Espaços", "Spaces"],
    ordenarAlfabetica: ["Classificar em ordem alfabética", "Ordenar em ordem alfabética", "Sort alphabetically", "Sort by name"],
    ordenarRecentes: ["Ordenar por mais recentes", "Classificar por mais recentes", "Sort by most recent", "Most recent activity"],
    criarSecao: ["Criar seção", "Criar seção personalizada", "Create section"],
    // Botões de confirmação em diálogos.
    confirmar: ["Criar", "Concluído", "Salvar", "Create", "Done", "Save", "Add"]
  };

  const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
  const semAcento = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

  // ===========================================================================
  // OVERLAY de progresso — a "falha visível". Fica no canto e loga tudo.
  // ===========================================================================
  const Overlay = (function () {
    let box, logEl, cancelado = false;
    function garantir() {
      if (box) return;
      box = document.createElement("div");
      box.id = "l2chat-overlay";
      box.style.cssText = [
        "position:fixed", "z-index:2147483647", "right:16px", "bottom:16px",
        "width:360px", "max-height:60vh", "background:#1f1f1f", "color:#eee",
        "font:13px/1.4 system-ui,Segoe UI,Roboto,sans-serif", "border-radius:12px",
        "box-shadow:0 8px 30px rgba(0,0,0,.4)", "overflow:hidden", "display:flex", "flex-direction:column"
      ].join(";");
      const head = document.createElement("div");
      head.style.cssText = "padding:10px 12px;background:#2b2b2b;font-weight:600;display:flex;justify-content:space-between;align-items:center";
      head.innerHTML = "<span>Organizando barra lateral…</span>";
      const btn = document.createElement("button");
      btn.textContent = "Parar";
      btn.style.cssText = "background:#c0392b;color:#fff;border:0;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px";
      btn.onclick = () => { cancelado = true; log("⏹ Parada solicitada. Encerrando após o passo atual…"); };
      head.appendChild(btn);
      logEl = document.createElement("div");
      logEl.style.cssText = "padding:10px 12px;overflow:auto;flex:1";
      box.appendChild(head);
      box.appendChild(logEl);
      document.body.appendChild(box);
    }
    function log(msg, tipo) {
      garantir();
      const line = document.createElement("div");
      line.style.cssText = "margin:2px 0;white-space:pre-wrap;" +
        (tipo === "erro" ? "color:#ff7675" : tipo === "ok" ? "color:#55efc4" : "");
      line.textContent = msg;
      logEl.appendChild(line);
      logEl.scrollTop = logEl.scrollHeight;
    }
    return {
      log,
      reset() { cancelado = false; garantir(); logEl.innerHTML = ""; },
      cancelado: () => cancelado,
      fim(msg) { log(msg, "ok"); }
    };
  })();

  // ===========================================================================
  // Helpers de DOM ancorados em texto / aria — nunca em classe.
  // ===========================================================================

  // Todos os elementos "clicáveis de menu" cujo texto casa com alguma das opções.
  function acharItemPorTexto(textos) {
    const alvos = textos.map(semAcento);
    const cands = document.querySelectorAll('[role="menuitem"],[role="menuitemradio"],[role="option"],button,[role="button"]');
    for (const el of cands) {
      const t = semAcento(el.innerText || el.getAttribute("aria-label") || "");
      if (!t) continue;
      if (alvos.some((a) => t === a || t.includes(a))) {
        if (el.offsetParent !== null || el.getClientRects().length) return el;
      }
    }
    return null;
  }

  // Botão ⋮ (mais opções) da seção "Espaços".
  function acharBotaoMenuEspacos() {
    const alvos = TXT.espacos.map(semAcento);
    const botoes = document.querySelectorAll('button,[role="button"]');
    let melhor = null;
    for (const b of botoes) {
      const al = semAcento(b.getAttribute("aria-label") || b.getAttribute("data-tooltip") || "");
      if (!al) continue;
      const pareceMenu = /mais opc|more option|opcoes|options|menu/.test(al);
      const mencionaEspacos = alvos.some((a) => al.includes(a));
      if (pareceMenu && mencionaEspacos) return b;
      if (pareceMenu && !melhor) melhor = b; // fallback: primeiro "mais opções"
    }
    return melhor;
  }

  // Abre o menu ⋮ dos Espaços e devolve o container do menu aberto.
  async function abrirMenuEspacos() {
    const btn = acharBotaoMenuEspacos();
    if (!btn) throw new Error('Não achei o menu ⋮ da seção "Espaços". O layout do Chat pode ter mudado.');
    btn.scrollIntoView({ block: "center" });
    clicar(btn);
    await dorme(400);
  }

  // Fecha qualquer menu/diálogo aberto.
  async function fechar() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await dorme(200);
  }

  function clicar(el) {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    for (const tipo of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      el.dispatchEvent(new MouseEvent(tipo, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 }));
    }
  }

  // Rótulos que NÃO são espaços — barra superior, conta, apps, dicas, atalhos.
  // A leitura pega qualquer aria-label; este bloqueio tira o ruído da tela.
  const NAO_E_ESPACO = /^(logotipo|logo\b|google apps|aplicativos do google|conta do google|google account|conta:|configura|settings|notifica|menu\b|menu principal|main menu|pesquisar|search|abrir no app|open in app|novo chat|new chat|nova conversa|in[íi]cio|home|men[çc][õo]es|mentions|com estrela|starred|mensagens diretas|direct messages|atalhos|shortcuts|ajuda|help|feedback|press?ione a tecla|press tab|barra lateral|navega[çc])/i;

  // Acha o container da barra lateral (a lista de espaços), para não ler a
  // barra superior. Escolhe a região de navegação com mais itens "[prefixo]".
  function acharSidebar() {
    const navs = document.querySelectorAll('nav,[role="navigation"],[role="tree"],[role="list"]');
    let melhor = null, melhorScore = -1;
    for (const n of navs) {
      if (n.closest('[role="banner"],header')) continue;
      const labels = n.querySelectorAll("[aria-label]");
      let score = 0;
      for (const el of labels) {
        const t = (el.getAttribute("aria-label") || "").trim();
        if (/^\s*\[/.test(t)) score++; // conta itens com colchete = espaços da L2
      }
      if (score > melhorScore) { melhorScore = score; melhor = n; }
    }
    return melhorScore > 0 ? melhor : null;
  }

  // Lê os espaços da barra lateral: retorna [{el, nome}]. Ancora em role/aria.
  function lerEspacos() {
    const vistos = new Map();
    const raiz = acharSidebar() || document; // escopo: só a barra lateral
    const cands = raiz.querySelectorAll('[role="listitem"] [aria-label], a[aria-label], [role="option"][aria-label], [role="treeitem"][aria-label]');
    for (const el of cands) {
      const nome = (el.getAttribute("aria-label") || "").trim();
      if (!nome) continue;
      // Fora barra superior/cabeçalho e ruído de UI.
      if (el.closest('[role="banner"],header')) continue;
      if (NAO_E_ESPACO.test(nome)) continue;
      if (/^(mais opc|more option|adicionar|add |nova |new )/i.test(nome)) continue;
      if (nome.length > 120) continue; // dicas/tooltips longos não são espaços
      const linha = el.closest('[role="listitem"],[role="option"],[role="treeitem"]') || el;
      if (!vistos.has(nome)) vistos.set(nome, linha);
    }
    return Array.from(vistos, ([nome, el]) => ({ nome, el }));
  }

  // Nomes das seções personalizadas já existentes (para idempotência).
  function lerSecoesExistentes() {
    const nomes = new Set();
    // Cabeçalhos de seção geralmente têm role e o nome como texto/aria.
    const cands = document.querySelectorAll('[role="heading"], [aria-expanded], [role="button"][aria-label]');
    for (const el of cands) {
      const txt = (el.innerText || el.getAttribute("aria-label") || "").trim();
      if (!txt) continue;
      if (TXT.espacos.some((e) => semAcento(txt) === semAcento(e))) continue;
      // Heurística: seção personalizada é curta e não é um espaço.
      if (txt.length <= 40 && !/\n/.test(txt)) nomes.add(txt);
    }
    return nomes;
  }

  // ===========================================================================
  // Passos
  // ===========================================================================

  async function passoOrdenar(textos, rotulo) {
    await abrirMenuEspacos();
    const item = acharItemPorTexto(textos);
    if (!item) { await fechar(); throw new Error(`Não achei a opção "${rotulo}" no menu.`); }
    clicar(item);
    await dorme(700);
    Overlay.log(`✓ ${rotulo}`, "ok");
  }

  async function passoCriarSecao(nome) {
    await abrirMenuEspacos();
    const item = acharItemPorTexto(TXT.criarSecao);
    if (!item) { await fechar(); throw new Error('Não achei "Criar seção" no menu.'); }
    clicar(item);
    await dorme(500);
    // Campo de texto do diálogo.
    const campo = document.querySelector('input[type="text"]:not([readonly]), [role="dialog"] input, [role="textbox"][contenteditable="true"]');
    if (!campo) { await fechar(); throw new Error("Não achei o campo de nome da seção."); }
    campo.focus();
    // Digita via execCommand/valor + eventos, para o Chat registrar.
    if ("value" in campo) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(campo, nome);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      campo.textContent = nome;
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await dorme(300);
    const ok = acharItemPorTexto(TXT.confirmar);
    if (ok) { clicar(ok); } else { campo.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); }
    await dorme(700);
    Overlay.log(`✓ Seção criada: ${nome}`, "ok");
  }

  // Arraste best-effort. Tenta pointer + drag HTML5. Retorna true se disparou
  // sem erro (não garante que o Chat aceitou — a reconferência valida).
  async function arrastar(origemEl, alvoEl) {
    const ro = origemEl.getBoundingClientRect();
    const ra = alvoEl.getBoundingClientRect();
    const de = { x: ro.left + ro.width / 2, y: ro.top + ro.height / 2 };
    const para = { x: ra.left + ra.width / 2, y: ra.top + Math.min(ra.height / 2, 16) };
    const dt = new DataTransfer();

    function ev(tipo, pt, ctor, extra) {
      const opts = Object.assign({ bubbles: true, cancelable: true, view: window, clientX: pt.x, clientY: pt.y, button: 0 }, extra || {});
      const e = new ctor(tipo, opts);
      if (extra && extra.dataTransfer) { try { Object.defineProperty(e, "dataTransfer", { value: dt }); } catch (_) {} }
      return e;
    }

    origemEl.dispatchEvent(ev("pointerdown", de, PointerEvent));
    origemEl.dispatchEvent(ev("mousedown", de, MouseEvent));
    await dorme(120);
    origemEl.dispatchEvent(ev("dragstart", de, DragEvent, { dataTransfer: dt }));
    // Movimento em passos até o alvo.
    const N = 8;
    for (let i = 1; i <= N; i++) {
      const pt = { x: de.x + (para.x - de.x) * (i / N), y: de.y + (para.y - de.y) * (i / N) };
      const alvoAtual = document.elementFromPoint(pt.x, pt.y) || alvoEl;
      alvoAtual.dispatchEvent(ev("pointermove", pt, PointerEvent));
      alvoAtual.dispatchEvent(ev("mousemove", pt, MouseEvent));
      alvoAtual.dispatchEvent(ev("dragover", pt, DragEvent, { dataTransfer: dt }));
      await dorme(60);
    }
    alvoEl.dispatchEvent(ev("drop", para, DragEvent, { dataTransfer: dt }));
    alvoEl.dispatchEvent(ev("pointerup", para, PointerEvent));
    alvoEl.dispatchEvent(ev("mouseup", para, MouseEvent));
    origemEl.dispatchEvent(ev("dragend", para, DragEvent, { dataTransfer: dt }));
    await dorme(400);
    return true;
  }

  // Acha o elemento de destino "seção X" pelo nome (o cabeçalho onde soltar).
  function acharSecaoEl(nome) {
    const alvo = semAcento(nome);
    const cands = document.querySelectorAll('[role="heading"], [aria-expanded], [role="button"][aria-label], [role="listitem"]');
    for (const el of cands) {
      const txt = semAcento(el.innerText || el.getAttribute("aria-label") || "");
      if (txt && (txt === alvo || txt.includes(alvo))) return el;
    }
    return null;
  }

  // ===========================================================================
  // Orquestração — recebe o plano e opções, executa os 4 passos.
  // ===========================================================================
  async function aplicar(config, decisoes) {
    Overlay.reset();
    Overlay.log("Lendo espaços da barra lateral…");

    // Passo 1 — ordem alfabética (andaime).
    try {
      await passoOrdenar(TXT.ordenarAlfabetica, "Ordem alfabética");
    } catch (e) {
      Overlay.log("⚠ " + e.message + " Sigo mesmo assim.", "erro");
    }
    await dorme(600);

    const espacos = lerEspacos();
    if (!espacos.length) throw new Error("Não li nenhum espaço. Abra o Google Chat com a lista de espaços visível.");
    Overlay.log(`Encontrei ${espacos.length} espaços.`);

    // Plano por nome.
    const plano = L2.planejar(espacos.map((e) => e.nome), config);
    // Aplica decisões manuais (item 2.1 / sem correspondência) por nome.
    const decMap = new Map((decisoes || []).map((d) => [d.nome, d.secao])); // secao=null => ignorar
    for (const p of plano) {
      if ((p.motivo === "perguntar") && decMap.has(p.nome)) {
        const s = decMap.get(p.nome);
        p.secao = s || null;
        p.motivo = s ? "manual" : "ignorar";
      }
    }

    // Passo 2 — criar seções que faltam (idempotente).
    const existentes = lerSecoesExistentes();
    const necessarias = L2.secoesNecessarias(plano, config);
    for (const s of necessarias) {
      if (Overlay.cancelado()) return finalizar();
      const jaTem = Array.from(existentes).some((x) => semAcento(x) === semAcento(s));
      if (jaTem) { Overlay.log(`• Seção já existe: ${s}`); continue; }
      try { await passoCriarSecao(s); existentes.add(s); }
      catch (e) { Overlay.log(`✗ Falha ao criar "${s}": ${e.message}`, "erro"); }
    }

    // Passo 3 — arrastar.
    let movidos = 0, pulados = 0, falhas = 0;
    for (const p of plano) {
      if (Overlay.cancelado()) break;
      if (!p.secao) { // ignorar / perguntar sem decisão
        pulados++;
        if (p.motivo === "perguntar") Overlay.log(`? Sem decisão, deixei quieto: "${p.nome}"`);
        continue;
      }
      // Reconfere posição atual do espaço (lista virtualizada muda).
      const atuais = lerEspacos();
      const alvoEsp = atuais.find((e) => e.nome === p.nome);
      if (!alvoEsp) { Overlay.log(`✗ Não achei mais no DOM: "${p.nome}" (role a lista).`, "erro"); falhas++; continue; }
      const secaoEl = acharSecaoEl(p.secao);
      if (!secaoEl) { Overlay.log(`✗ Não achei a seção "${p.secao}".`, "erro"); falhas++; continue; }
      alvoEsp.el.scrollIntoView({ block: "center" });
      await dorme(150);
      try {
        await arrastar(alvoEsp.el, secaoEl);
        movidos++;
        Overlay.log(`→ "${p.nome}"  ⇒  ${p.secao}`);
      } catch (e) {
        falhas++;
        Overlay.log(`✗ Arraste falhou: "${p.nome}" — ${e.message}`, "erro");
      }
    }

    // Passo 4 — voltar para mais recentes.
    try {
      await passoOrdenar(TXT.ordenarRecentes, "Mais recentes");
    } catch (e) {
      Overlay.log("⚠ " + e.message, "erro");
    }

    return finalizar();

    function finalizar() {
      Overlay.fim(`Concluído. Movidos: ${movidos} · Pulados: ${pulados} · Falhas: ${falhas}.`);
      if (falhas) Overlay.log("Os itens com ✗ podem precisar de arraste manual. Nada foi renomeado ou removido.", "erro");
      return { movidos, pulados, falhas };
    }
  }

  // ===========================================================================
  // Ponte com o popup.
  // ===========================================================================
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      try {
        if (msg.tipo === "ping") {
          sendResponse({ ok: true });
        } else if (msg.tipo === "ler-espacos") {
          const espacos = lerEspacos().map((e) => e.nome);
          sendResponse({ ok: true, espacos });
        } else if (msg.tipo === "aplicar") {
          const r = await aplicar(msg.config, msg.decisoes);
          sendResponse({ ok: true, resultado: r });
        } else {
          sendResponse({ ok: false, erro: "Comando desconhecido." });
        }
      } catch (e) {
        try { Overlay.log("✗ " + e.message, "erro"); } catch (_) {}
        sendResponse({ ok: false, erro: e.message });
      }
    })();
    return true; // resposta assíncrona
  });
})();
