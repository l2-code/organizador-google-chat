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
    let box, logEl, cancelado = false, fechado = false;
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
      head.style.cssText = "padding:10px 12px;background:#2b2b2b;font-weight:600;display:flex;justify-content:space-between;align-items:center;gap:8px";
      const titulo = document.createElement("span");
      titulo.textContent = "Organizando barra lateral…";
      titulo.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      const acoes = document.createElement("div");
      acoes.style.cssText = "display:flex;gap:6px;align-items:center;flex:0 0 auto";
      const btn = document.createElement("button");
      btn.textContent = "Parar";
      btn.style.cssText = "background:#c0392b;color:#fff;border:0;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px";
      btn.onclick = () => { cancelado = true; log("⏹ Parada solicitada. Encerrando após o passo atual…"); };
      const fechar = document.createElement("button");
      fechar.textContent = "✕";
      fechar.title = "Fechar";
      fechar.setAttribute("aria-label", "Fechar");
      fechar.style.cssText = "background:transparent;color:#bbb;border:0;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:14px;line-height:1";
      fechar.onmouseenter = () => (fechar.style.color = "#fff");
      fechar.onmouseleave = () => (fechar.style.color = "#bbb");
      fechar.onclick = () => { fechado = true; cancelado = true; if (box) { box.remove(); box = null; } };
      acoes.appendChild(btn);
      acoes.appendChild(fechar);
      head.appendChild(titulo);
      head.appendChild(acoes);
      logEl = document.createElement("div");
      logEl.style.cssText = "padding:10px 12px;overflow:auto;flex:1";
      box.appendChild(head);
      box.appendChild(logEl);
      document.body.appendChild(box);
    }
    function log(msg, tipo) {
      if (fechado) return; // usuário fechou o painel — não ressuscita no meio
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
      reset() { cancelado = false; fechado = false; garantir(); logEl.innerHTML = ""; },
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

  // Cabeçalho de uma seção = div[role="button"] com o nome como texto. Prefere o
  // cabeçalho real (ancorado no botão "Ações da seção"), mas cai num fallback pela
  // barra lateral — seção recém-criada (vazia) ou layout diferente às vezes não
  // expõe a âncora, e sem o fallback a extensão "não achava a seção" que existe.
  function cabecalhoDaSecao(nome) {
    const alvo = semAcento(nome);
    const cands = [...document.querySelectorAll('div[role="button"]')].filter(
      (b) => semAcento((b.innerText || "").replace(/\n/g, " ").trim()) === alvo);
    if (!cands.length) return null;
    const ancorado = cands.find(temAcoesSecaoPerto);
    if (ancorado) return ancorado;
    const naLateral = cands.find((b) => !b.closest('[role="main"],main'));
    return naLateral || cands[0];
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

  // ---------------------------------------------------------------------------
  // Filtro "mensagens não lidas". Quando LIGADO, o Chat esconde do DOM os espaços
  // já lidos — a extensão não os leria nem moveria (era o "não funcionou" de quem
  // tinha a barra em modo só-não-lidas). Estratégia: desligar antes de trabalhar,
  // guardar ONDE estava ligado, e religar exatamente esses no fim.
  // ---------------------------------------------------------------------------
  function switchesNaoLidas() {
    const out = [], vistas = new Set();
    for (const s of document.querySelectorAll('[role="switch"]')) {
      const rot = semAcento((s.getAttribute("aria-label") || "") + " " + (s.innerText || ""));
      if (!(rot.includes("nao lida") || rot.includes("unread"))) continue;
      // O Chat mantém cópias do DOM; deduplica por seção+estado para não clicar
      // duas vezes no mesmo toggle. (Não filtra por visibilidade: o toggle só
      // aparece no hover, mas o elemento existe e responde ao clique sintético.)
      const chave = semAcento(secaoDoSwitch(s) || "?") + "|" + s.getAttribute("aria-checked");
      if (vistas.has(chave)) continue;
      vistas.add(chave);
      out.push(s);
    }
    return out;
  }

  // O toggle fica no cabeçalho de UMA seção; todos têm o mesmo aria-label, então
  // a identidade para religar o mesmo é o NOME da seção onde o switch está.
  function secaoDoSwitch(sw) {
    let c = sw.parentElement;
    for (let i = 0; i < 6 && c; i++) {
      const h = [...c.querySelectorAll('div[role="button"]')].find((b) => {
        const t = (b.innerText || "").replace(/\n/g, " ").trim();
        if (!t || t.length > 40 || /^\d+$/.test(t)) return false;
        return CABECALHOS_FIXOS.includes(semAcento(t)) || temAcoesSecaoPerto(b);
      });
      if (h) return (h.innerText || "").replace(/\n/g, " ").trim();
      c = c.parentElement;
    }
    return null;
  }

  async function desligarNaoLidas() {
    const ligados = switchesNaoLidas().filter((s) => s.getAttribute("aria-checked") === "true");
    const secoes = [];
    for (const s of ligados) { secoes.push(secaoDoSwitch(s)); clicar(s); await dorme(300); }
    if (ligados.length) {
      Overlay.log(`Filtro "não lidas" estava ligado — desliguei em ${ligados.length} seção(ões) para ver todos os espaços (religo no fim).`);
      await dorme(500);
    }
    return secoes; // nomes das seções onde estava ligado (para religar os mesmos)
  }

  async function religarNaoLidas(secoes) {
    if (!secoes || !secoes.length) return;
    const restam = secoes.slice();
    let n = 0;
    for (const s of switchesNaoLidas()) {
      if (s.getAttribute("aria-checked") !== "false") continue;
      const sec = secaoDoSwitch(s);
      const i = restam.findIndex((x) => semAcento(x || "") === semAcento(sec || ""));
      if (i >= 0) { clicar(s); restam.splice(i, 1); n++; await dorme(300); }
    }
    if (n) Overlay.log(`Filtro "não lidas" religado em ${n} seção(ões).`, "ok");
  }

  // ---------------------------------------------------------------------------
  // Setas de recolher/expandir das seções. Seção recolhida NÃO renderiza seus
  // espaços no DOM — então some do alcance da extensão. Abre para trabalhar e
  // restaura o estado original no fim. O controle é um div[role="button"] com
  // aria-expanded ("false"=recolhida), sem texto, na mesma linha do nome (o
  // botão ⋮ "Ações da seção" também tem aria-expanded, mas é do menu — excluído).
  // ---------------------------------------------------------------------------
  function secoesHeaders() {
    return [...document.querySelectorAll('div[role="button"]')].filter((b) => {
      const t = (b.innerText || "").replace(/\n/g, " ").trim();
      if (!t || t.length > 40 || /^\d+$/.test(t)) return false;
      const n = semAcento(t);
      const eCatchall = n === "espacos" || n === "spaces";
      if (CABECALHOS_FIXOS.includes(n) && !eCatchall) return false; // não mexe em Atalhos/DMs/Apps
      return eCatchall || temAcoesSecaoPerto(b);
    });
  }

  function controleRecolher(header) {
    let c = header;
    for (let i = 0; i < 4 && c; i++) {
      const ctrl = [...c.querySelectorAll('[role="button"][aria-expanded]')].find((e) =>
        !/acoes da secao|section options/.test(semAcento(e.getAttribute("aria-label") || "")));
      if (ctrl) return ctrl;
      c = c.parentElement;
    }
    return null;
  }

  // Estado original das seções: nome -> aria-expanded ("true"/"false"), para
  // restaurar exatamente (o arraste do Chat minimiza todas as seções no meio).
  function mapaSecoesExpand() {
    const m = new Map();
    for (const h of secoesHeaders()) {
      const nome = (h.innerText || "").replace(/\n/g, " ").trim();
      const ctrl = controleRecolher(h);
      if (ctrl) m.set(semAcento(nome), ctrl.getAttribute("aria-expanded"));
    }
    return m;
  }

  async function abrirTodasSecoes() {
    let n = 0;
    for (const h of secoesHeaders()) {
      const ctrl = controleRecolher(h);
      if (ctrl && ctrl.getAttribute("aria-expanded") === "false") { clicar(ctrl); n++; await dorme(250); }
    }
    if (n) { Overlay.log(`Abri ${n} seção(ões) recolhida(s) para poder trabalhar.`); await dorme(400); }
  }

  async function restaurarSecoes(orig) {
    if (!orig || !orig.size) return;
    let n = 0;
    for (const h of secoesHeaders()) {
      const nome = semAcento((h.innerText || "").replace(/\n/g, " ").trim());
      if (!orig.has(nome)) continue;
      const ctrl = controleRecolher(h);
      if (ctrl && ctrl.getAttribute("aria-expanded") !== orig.get(nome)) { clicar(ctrl); n++; await dorme(250); }
    }
    if (n) Overlay.log(`Restaurei ${n} seção(ões) ao estado original.`, "ok");
  }

  // ---------------------------------------------------------------------------
  // Preparar (no "Ler") e restaurar (no "Aplicar"). O estado original é guardado
  // no módulo, entre as duas mensagens: "Ler" prepara e DEIXA preparado; "Aplicar"
  // faz o trabalho e devolve tudo ao original.
  // ---------------------------------------------------------------------------
  let _estadoOriginalSecoes = null; // Map nome->aria-expanded (capturado 1x no Ler)
  let _filtrosDesligados = [];      // seções onde desliguei "não lidas"

  async function prepararDOM() {
    if (_estadoOriginalSecoes === null) _estadoOriginalSecoes = mapaSecoesExpand();
    const desligados = await desligarNaoLidas();
    for (const s of desligados) _filtrosDesligados.push(s);
    await abrirTodasSecoes();
  }

  async function restaurarDOM() {
    await restaurarSecoes(_estadoOriginalSecoes);
    await religarNaoLidas(_filtrosDesligados);
    _estadoOriginalSecoes = null;
    _filtrosDesligados = [];
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
      // A seção catch-all "Espaços" (espaços ainda sem seção) tem aria "Lista de
      // espaços" — NÃO "lista de conversas". Sem incluí-la, os espaços soltos ali
      // (ex.: "[OLD]…" que sobraram) nunca eram lidos, planejados nem movidos.
      const eEspacos = l.includes("lista de espacos") || l.includes("spaces list") || l.includes("list of spaces") || l.includes("space list");
      const eDM = l.includes("mensagens diretas") || l.includes("direct message");
      const eApps = l.includes("lista de apps") || l.includes("apps list") || l.includes("list of apps");
      return (eConversa || eEspacos) && !eDM && !eApps;
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

  // Mapa nome-do-espaço → nome-da-seção-atual, para NÃO mover o que já está no
  // lugar (respeita quem organizou na mão e torna a re-execução segura).
  // Percorre a barra em ordem de documento: cada espaço herda o último
  // cabeçalho de seção visto antes dele.
  function secaoAtualDosEspacos() {
    const map = new Map();
    const nodes = document.querySelectorAll('div[role="button"], [role="list"] [role="listitem"] [role="link"]');
    let atual = null;
    for (const el of nodes) {
      if (el.matches('div[role="button"]')) {
        const t = (el.innerText || "").replace(/\n/g, " ").trim();
        const norm = semAcento(t);
        if (t && t.length <= 40 && !/^\d+$/.test(t)) {
          if (CABECALHOS_FIXOS.includes(norm)) {
            // Cabeçalho FIXO (a catch-all "Espaços", Mensagens diretas, Apps…):
            // saímos das seções personalizadas. Zera o corrente para que o espaço
            // que estiver aqui NÃO herde a última seção custom. Sem isto, um
            // "[OLD]…" parado em "Espaços" logo abaixo da seção OLD era lido como
            // "já no lugar" e nunca movia.
            atual = null;
          } else if (temAcoesSecaoPerto(el)) {
            atual = t; // entrou numa seção personalizada
          }
        }
      } else {
        const nome = nomeDoLink(el);
        if (nome && atual && !map.has(nome)) map.set(nome, atual);
      }
    }
    return map;
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
    await dorme(600);
    // O Chat foca um input com placeholder "Nome da seção". NÃO usar um
    // querySelector genérico de input[type=text]: o 1º da página é a busca
    // "Pesquisar chat" — o nome ia pra lá e a seção nascia EM BRANCO (bug).
    const ehBusca = (el) => /pesquisar|search/i.test(
      (el.getAttribute("aria-label") || "") + " " + (el.getAttribute("placeholder") || ""));
    const visivel = (el) => el && (el.offsetParent !== null || el.getClientRects().length);
    let campo = null;
    const ae = document.activeElement;
    if (ae && ae.tagName === "INPUT" && !ehBusca(ae)) campo = ae;
    if (!campo) campo = [...document.querySelectorAll('input[type="text"]')].find(
      (e) => /nome da se|section name/i.test(e.getAttribute("placeholder") || "") && visivel(e));
    if (!campo) { await fechar(); throw new Error("Não achei o campo de nome da seção."); }
    campo.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(campo, nome);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
    campo.dispatchEvent(new Event("change", { bubbles: true }));
    await dorme(350);
    // Confirmar com "Salvar" — procura ancorado no campo (junto de "Cancelar"),
    // depois global, e por fim Enter.
    let salvar = null, cont = campo;
    for (let k = 0; k < 6 && cont; k++) {
      cont = cont.parentElement; if (!cont) break;
      salvar = [...cont.querySelectorAll("button,[role=button]")].find((b) => {
        const t = (b.innerText || b.getAttribute("aria-label") || "").trim();
        return /^(salvar|save|concluído|concluir|criar|done|create)$/i.test(t);
      });
      if (salvar) break;
    }
    if (!salvar) salvar = acharItemPorTexto(["Salvar", "Save", "Concluído", "Criar", "Done", "Create"], /cancel/);
    if (salvar) { clicar(salvar); } else { campo.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); }
    await dorme(800);
    // Garante que a seção NOMEADA existe — senão foi criada em branco (não loga sucesso falso).
    if (!cabecalhoDaSecao(nome)) throw new Error(`o nome "${nome}" não colou (seção em branco)`);
    Overlay.log(`✓ Seção criada: ${nome}`, "ok");
  }

  // Limpa seções em branco (linhas de "Nome da seção" vazias, presas em edição —
  // resquício do bug antigo que criava seção sem nome). Cancela cada uma.
  async function limparSecoesEmBranco() {
    let removidas = 0;
    for (let i = 0; i < 40; i++) {
      const vazio = [...document.querySelectorAll('input[type="text"]')].find(
        (e) => /nome da se|section name/i.test(e.getAttribute("placeholder") || "") &&
               !(e.value || "").trim() && (e.offsetParent !== null || e.getClientRects().length));
      if (!vazio) break;
      let cont = vazio, btn = null;
      for (let k = 0; k < 6 && cont; k++) {
        cont = cont.parentElement; if (!cont) break;
        btn = [...cont.querySelectorAll("button,[role=button]")].find((b) =>
          /cancelar|cancel|descartar|discard/i.test((b.innerText || b.getAttribute("aria-label") || "")));
        if (btn) break;
      }
      if (btn) clicar(btn); else vazio.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await dorme(250);
      removidas++;
    }
    if (removidas) Overlay.log(`Limpei ${removidas} seção(ões) em branco.`, "ok");
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

    // 2) Resolve o cabeçalho de destino pelo NOME e ROLA até a tela. O arraste
    //    sintético NÃO rola sozinho: se o cabeçalho estiver fora da tela, o item
    //    cai na seção vizinha visível (era o caso de alguns [OLD] → Espaços).
    const acharHeader = () => {
      const alvoNome = semAcento(nomeSecao);
      return [...document.querySelectorAll('div[role="button"]')].find(
        (b) => semAcento((b.innerText || "").replace(/\n/g, " ").trim()) === alvoNome);
    };
    let alvoEl = acharHeader();
    if (!alvoEl) {
      origemEl.dispatchEvent(ev("pointerup", de, PointerEvent));
      origemEl.dispatchEvent(ev("dragend", de, DragEvent, { dataTransfer: dt }));
      throw new Error(`destino "${nomeSecao}" não encontrado`);
    }
    alvoEl.scrollIntoView({ block: "center" });
    await dorme(400);
    alvoEl = acharHeader() || alvoEl; // re-acha após rolar (DOM pode reflexar)
    const ra = alvoEl.getBoundingClientRect();
    const para = { x: ra.left + ra.width / 2, y: ra.top + ra.height / 2 };

    // 3) Aproxima o ponteiro do cabeçalho de cima para baixo e solta NO centro.
    for (let i = 6; i >= 1; i--) {
      mover({ x: para.x, y: para.y - i * 6 });
      await dorme(50);
    }
    const solta = document.elementFromPoint(para.x, para.y) || alvoEl;
    solta.dispatchEvent(ev("dragover", para, DragEvent, { dataTransfer: dt }));
    await dorme(80);
    solta.dispatchEvent(ev("drop", para, DragEvent, { dataTransfer: dt }));
    solta.dispatchEvent(ev("pointerup", para, PointerEvent));
    solta.dispatchEvent(ev("mouseup", para, MouseEvent));
    origemEl.dispatchEvent(ev("dragend", para, DragEvent, { dataTransfer: dt }));
    await dorme(550);
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
    let movidos = 0, pulados = 0, falhas = 0, jaOk = 0;

    // Garante o DOM pronto (caso "Aplicar" seja clicado sem "Ler" antes, ou o
    // estado tenha mudado): desliga "não lidas" e abre as seções recolhidas.
    // O "Ler" já costuma ter feito isso; aqui é idempotente. Restaura no finally.
    await prepararDOM();
    try {

    // Passo 0 — limpa seções em branco (resquício do bug antigo de criar sem nome).
    await limparSecoesEmBranco();

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
    // Fotografa a seção atual de cada espaço UMA vez: só o espaço movido muda
    // de seção durante a rodada, e não o revisito.
    const secaoAtual = secaoAtualDosEspacos();
    for (const p of plano) {
      if (Overlay.cancelado()) break;
      if (!p.secao) { // ignorar / perguntar sem decisão
        pulados++;
        if (p.motivo === "perguntar") Overlay.log(`? Sem decisão, deixei quieto: "${p.nome}"`);
        continue;
      }
      // Já está na seção certa? Não mexe (respeita organização manual / re-execução).
      if (semAcento(secaoAtual.get(p.nome) || "") === semAcento(p.secao)) {
        jaOk++; continue;
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

    } finally {
      await restaurarDOM();
    }

    function finalizar() {
      Overlay.fim(`Concluído. Movidos: ${movidos} · Já no lugar: ${jaOk} · Pulados: ${pulados} · Falhas: ${falhas}.`);
      if (falhas) Overlay.log("Os itens com ✗ podem precisar de arraste manual. Nada foi renomeado ou removido.", "erro");
      return { movidos, jaOk, pulados, falhas };
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
          await prepararDOM(); // início: desliga "não lidas" e abre seções recolhidas (deixa preparado; o "aplicar" restaura)
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
