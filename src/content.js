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

  // Item de menu cujo texto casa com uma das opções. `evitar` (regex normalizada)
  // descarta parecidos — ex.: "Criar seção" não pode pegar "Criar seção de reunião".
  // Prefere igualdade exata; só cai em "contém" se não houver exato.
  function acharItemPorTexto(textos, evitar) {
    const alvos = textos.map(semAcento);
    const cands = [...document.querySelectorAll('[role="menuitem"],[role="menuitemradio"],[role="option"],span,button,[role="button"]')];
    const visivel = (el) => el.offsetParent !== null || el.getClientRects().length;
    const clicavel = (el) => el.closest('[role="menuitem"],[role="menuitemradio"],[role="option"],button,[role="button"]') || el;
    // 1ª passada: igualdade exata
    for (const el of cands) {
      const t = semAcento(el.innerText || el.getAttribute("aria-label") || "");
      if (!t || (evitar && evitar.test(t))) continue;
      if (alvos.includes(t) && visivel(el)) return clicavel(el);
    }
    // 2ª passada: contém
    for (const el of cands) {
      const t = semAcento(el.innerText || el.getAttribute("aria-label") || "");
      if (!t || (evitar && evitar.test(t))) continue;
      if (alvos.some((a) => t.includes(a)) && visivel(el)) return clicavel(el);
    }
    return null;
  }

  // Nomes de cabeçalho que NÃO são seções de espaços (não devem virar destino
  // nem contar como "seção existente").
  const CABECALHOS_FIXOS = ["espacos", "spaces", "mensagens diretas", "direct messages",
    "atalhos", "shortcuts", "ativo", "active", "apps", "aplicativos"].map(semAcento);

  // Um cabeçalho de seção real tem, na mesma linha, o botão "Ações da seção".
  // Isso separa o cabeçalho de botões da área de mensagens que teriam o mesmo texto.
  function temAcoesSecaoPerto(el) {
    let c = el;
    for (let i = 0; i < 4 && c; i++) {
      if (c.querySelector && [...c.querySelectorAll("button,[role=button]")].some((x) =>
        /acoes da secao|section options/.test(semAcento(x.getAttribute("aria-label") || "")))) return true;
      c = c.parentElement;
    }
    return false;
  }

  // Cabeçalho de uma seção = div[role="button"] com o nome como texto, ancorado
  // no botão "Ações da seção".
  function cabecalhoDaSecao(nome) {
    const alvo = semAcento(nome);
    return [...document.querySelectorAll('div[role="button"]')].find(
      (b) => semAcento((b.innerText || "").replace(/\n/g, " ").trim()) === alvo && temAcoesSecaoPerto(b)
    ) || null;
  }

  // Botão ⋮ ("Ações da seção") da seção "Espaços" — onde ficam Criar seção,
  // Classificar em ordem alfabética e Ordenar por mais recentes.
  function acharBotaoMenuEspacos() {
    const head = [...document.querySelectorAll('div[role="button"]')].find(
      (b) => TXT.espacos.map(semAcento).includes(semAcento((b.innerText || "").trim()))
    );
    if (head) {
      let cont = head;
      for (let i = 0; i < 5 && cont; i++) {
        const b = cont.querySelector && cont.querySelector("button");
        const acao = cont.querySelector &&
          [...cont.querySelectorAll("button,[role=button]")].find((x) =>
            /acoes da secao|section options|mais opc|more option|opcoes|options/.test(
              semAcento(x.getAttribute("aria-label") || "")));
        if (acao) return acao;
        cont = cont.parentElement;
      }
    }
    // Fallback: primeiro botão "Ações da seção" da página.
    return [...document.querySelectorAll("button,[role=button]")].find((x) =>
      /acoes da secao|section options/.test(semAcento(x.getAttribute("aria-label") || ""))) || null;
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

  // Sufixo de tipo que o Chat concatena no texto do link ("… Espaço Abrir em um
  // pop-up Opções") e badge de não lidas no começo. Removidos para sobrar o nome.
  const TIPO_SUFIXO = /\s+(Espaço|Espaços|Space|Spaces|Conversa em grupo|Group conversation|Mensagem direta|Direct message)\b[\s\S]*$/i;
  const BADGE_NAOLIDAS = /^\s*(\d+\s+)?(mensagens?\s+)?(não lidas?|nao lidas?|unread)\s*/i;

  // Extrai o nome limpo de um espaço a partir do seu elemento [role="link"].
  function nomeDoLink(link) {
    let t = (link.innerText || "").replace(/\s+/g, " ").trim();
    t = t.replace(BADGE_NAOLIDAS, "").replace(TIPO_SUFIXO, "").trim();
    return t;
  }

  // Listas que contêm espaços: role="list" com rótulo "Lista de conversas…"
  // (seções personalizadas e a seção Espaços). Exclui "Mensagens diretas".
  function listasDeEspacos() {
    return [...document.querySelectorAll('[role="list"]')].filter((n) => {
      const l = semAcento(n.getAttribute("aria-label") || "");
      const eConversa = l.includes("lista de conversas") || l.includes("conversation list") || l.includes("list of conversations");
      const eDM = l.includes("mensagens diretas") || l.includes("direct message");
      return eConversa && !eDM;
    });
  }

  // Lê os espaços da barra lateral: retorna [{el, nome}]. Cada espaço é um
  // [role="listitem"] com um [role="link"] dentro; o nome vem do texto do link.
  function lerEspacos() {
    const vistos = new Map();
    for (const lista of listasDeEspacos()) {
      for (const it of lista.querySelectorAll('[role="listitem"]')) {
        const link = it.querySelector('[role="link"]');
        if (!link) continue;
        const nome = nomeDoLink(link);
        if (!nome) continue;
        if (!vistos.has(nome)) vistos.set(nome, link); // link = elemento arrastável
      }
    }
    return Array.from(vistos, ([nome, el]) => ({ nome, el }));
  }

  // Nomes das seções já existentes (idempotência). Cabeçalho = div[role="button"]
  // com o nome como texto; ignora os fixos (Espaços, Mensagens diretas, Apps…).
  function lerSecoesExistentes() {
    const nomes = new Set();
    for (const b of document.querySelectorAll('div[role="button"]')) {
      const txt = (b.innerText || "").replace(/\n/g, " ").trim();
      if (!txt || txt.length > 40 || /^\d+$/.test(txt)) continue;
      if (CABECALHOS_FIXOS.includes(semAcento(txt))) continue;
      if (!temAcoesSecaoPerto(b)) continue; // só cabeçalhos de seção de verdade
      nomes.add(txt);
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
    // Evita "Criar seção de reunião", que também contém "criar seção".
    const item = acharItemPorTexto(TXT.criarSecao, /reuni|meeting/);
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
  // Arraste. IMPORTANTE: ao iniciar o arraste, o Google Chat MINIMIZA todas as
  // seções — sobram só os cabeçalhos e a posição do alvo muda. Por isso o destino
  // é re-resolvido pelo NOME depois que o arraste começa, e não antes.
  async function arrastar(origemEl, nomeSecao) {
    const ro = origemEl.getBoundingClientRect();
    const de = { x: ro.left + ro.width / 2, y: ro.top + ro.height / 2 };
    const dt = new DataTransfer();

    function ev(tipo, pt, ctor, extra) {
      const opts = Object.assign({ bubbles: true, cancelable: true, view: window, clientX: pt.x, clientY: pt.y, button: 0 }, extra || {});
      const e = new ctor(tipo, opts);
      if (extra && extra.dataTransfer) { try { Object.defineProperty(e, "dataTransfer", { value: dt }); } catch (_) {} }
      return e;
    }
    const mover = (pt) => {
      const el = document.elementFromPoint(pt.x, pt.y) || document.body;
      el.dispatchEvent(ev("pointermove", pt, PointerEvent));
      el.dispatchEvent(ev("mousemove", pt, MouseEvent));
      el.dispatchEvent(ev("dragover", pt, DragEvent, { dataTransfer: dt }));
      return el;
    };

    // 1) Inicia o arraste: pointerdown + pequenos movimentos para passar do limiar.
    origemEl.dispatchEvent(ev("pointerdown", de, PointerEvent));
    origemEl.dispatchEvent(ev("mousedown", de, MouseEvent));
    await dorme(150);
    origemEl.dispatchEvent(ev("dragstart", de, DragEvent, { dataTransfer: dt }));
    for (let i = 1; i <= 4; i++) { mover({ x: de.x, y: de.y + i * 6 }); await dorme(60); }

    // 2) Espera o Chat minimizar as seções e RE-RESOLVE o cabeçalho de destino.
    //    Durante o arraste o botão "Ações da seção" some, então casa só por texto.
    await dorme(450);
    const alvoNome = semAcento(nomeSecao);
    const alvoEl = [...document.querySelectorAll('div[role="button"]')].find(
      (b) => semAcento((b.innerText || "").replace(/\n/g, " ").trim()) === alvoNome
    );
    if (!alvoEl) { // não achou o destino minimizado: cancela sem soltar em lugar errado
      origemEl.dispatchEvent(ev("pointerup", de, PointerEvent));
      origemEl.dispatchEvent(ev("dragend", de, DragEvent, { dataTransfer: dt }));
      throw new Error(`destino "${nomeSecao}" não encontrado após minimizar`);
    }
    const ra = alvoEl.getBoundingClientRect();
    const para = { x: ra.left + ra.width / 2, y: ra.top + ra.height / 2 };

    // 3) Move até o cabeçalho (posição nova) em passos e solta NELE.
    const N = 10;
    for (let i = 1; i <= N; i++) {
      mover({ x: de.x + (para.x - de.x) * (i / N), y: de.y + (para.y - de.y) * (i / N) });
      await dorme(55);
    }
    const solta = document.elementFromPoint(para.x, para.y) || alvoEl;
    solta.dispatchEvent(ev("dragover", para, DragEvent, { dataTransfer: dt }));
    solta.dispatchEvent(ev("drop", para, DragEvent, { dataTransfer: dt }));
    solta.dispatchEvent(ev("pointerup", para, PointerEvent));
    solta.dispatchEvent(ev("mouseup", para, MouseEvent));
    origemEl.dispatchEvent(ev("dragend", para, DragEvent, { dataTransfer: dt }));
    await dorme(500);
    return true;
  }

  // Alvo do arraste = o cabeçalho da seção (div[role="button"] com o nome).
  function acharSecaoEl(nome) {
    return cabecalhoDaSecao(nome);
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
      if (!acharSecaoEl(p.secao)) { Overlay.log(`✗ Não achei a seção "${p.secao}".`, "erro"); falhas++; continue; }
      alvoEsp.el.scrollIntoView({ block: "center" });
      await dorme(200);
      try {
        await arrastar(alvoEsp.el, p.secao); // passa o NOME: destino é re-resolvido após o colapso
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
