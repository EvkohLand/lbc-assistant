(function () {
  'use strict';

  const { humanize, humanizeTitle } = window.Humanize;

  // ---------- Constantes ----------
  const STORAGE_KEY = 'lbc-assistant.apiKey';
  const OPENROUTER = 'https://openrouter.ai/api/v1';
  // Un modèle par rôle : lire les photos, rédiger, produire une image.
  const ROLES = {
    vision: {
      label: 'Analyse des photos', storage: 'lbc-assistant.model.vision', default: 'google/gemini-3.8-flash',
      hint: 'Doit accepter les images en entrée.',
      models: [
        { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash (lit bien les étiquettes)' },
        { id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash (très économique)' },
        { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5' },
        { id: 'openai/gpt-5.6-sol', label: 'GPT-5.6 Sol' },
      ],
    },
    text: {
      label: "Rédaction de l'annonce", storage: 'lbc-assistant.model.text', default: 'deepseek/deepseek-v4.1-flash',
      hint: 'Rédige titre et description.',
      models: [
        { id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash (meilleur rapport qualité prix)' },
        { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
        { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5 (plus cher)' },
        { id: 'openai/gpt-5.6-sol', label: 'GPT-5.6 Sol' },
      ],
    },
    image: {
      label: 'Photo mise en valeur', storage: 'lbc-assistant.model.image', default: 'openai/gpt-image-2.5-sunburst',
      hint: "Doit produire des images. Utilisé seulement quand vous le demandez.",
      models: [
        { id: 'openai/gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst' },
        { id: 'google/gemini-3.1-flash-image', label: 'Nano Banana 2 (moins cher)' },
      ],
    },
  };
  const MAX_PHOTOS = 10;
  const TITLE_MAX = 100;
  const DESC_MAX = 4000;

  const ETATS = [
    {
      id: 'neuf', label: 'État neuf', desc: 'Jamais utilisé, avec ou sans emballage',
      consigne: "Objet jamais utilisé. Insister sur le fait qu'il n'a jamais servi, préciser s'il y a l'emballage, la notice, une étiquette ou une facture si c'est indiqué. Argument : l'acheteur a du neuf moins cher qu'en magasin.",
    },
    {
      id: 'tres_bon', label: 'Très bon état', desc: 'Peu servi, aucune trace visible',
      consigne: "Objet peu utilisé, sans trace visible. Rassurer : entretenu, rangé avec soin, fonctionne parfaitement. Dire 'très peu servi' ou 'utilisé quelques fois' sans exagérer.",
    },
    {
      id: 'bon', label: 'Bon état', desc: "Utilisé, légères traces d'usage",
      consigne: "Objet utilisé normalement. Être honnête : mentionner les légères traces d'usage de façon précise (où, quelle taille) et affirmer ce qui fonctionne. L'honnêteté inspire confiance et évite les négociations en rendez-vous. Argument : bon rapport qualité prix.",
    },
    {
      id: 'satisfaisant', label: 'État satisfaisant', desc: "Traces d'usure visibles, fonctionne",
      consigne: "Objet avec une usure visible. Transparence totale sur chaque défaut connu, préciser que tout fonctionne si c'est le cas. Présenter le prix comme ajusté en conséquence : bonne affaire pour un usage quotidien sans se ruiner.",
    },
    {
      id: 'pieces', label: 'Pour pièces', desc: 'Hors service ou incomplet',
      consigne: "Objet vendu pour pièces ou à réparer. Dire clairement ce qui ne fonctionne pas ou ce qui manque, lister les pièces en bon état récupérables. Cibler les bricoleurs et réparateurs. Aucune promesse de fonctionnement.",
    },
  ];

  // ---------- État ----------
  const state = freshState();

  function freshState() {
    return {
      step: 'photos',
      photos: [], // { id, file, url, apiData, error }
      hint: '',
      analysis: null,
      facts: { objet: '', marque: '', modele: '', categorie: '', couleur: '', dimensions: '', matieres: '' },
      answers: {},
      details: { etat: '', prix: '', mainPropre: true, ville: '', envoi: false, notes: '' },
      ad: null,
      error: '',
      tab: 'apercu',
      enhance: { busy: false, url: '', error: '' },
    };
  }

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* stockage indisponible */ } },
  };
  const apiKey = () => store.get(STORAGE_KEY) || '';
  const model = (role) => store.get(ROLES[role].storage) || ROLES[role].default;

  // ---------- Utilitaires ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const app = $('#app');

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function uid() { return Math.random().toString(36).slice(2, 10); }
  function slugify(s) {
    return (s || 'annonce').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50).replace(/^-+|-+$/g, '') || 'annonce';
  }
  function formatPrice(p) {
    const n = Number(String(p).replace(',', '.'));
    if (!isFinite(n) || n <= 0) return '';
    return n.toLocaleString('fr-FR', { maximumFractionDigits: n % 1 ? 2 : 0 }) + ' €';
  }
  function etatById(id) { return ETATS.find((e) => e.id === id); }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e2) { /* rien de plus à tenter */ }
      ta.remove();
    }
    toast('Copié');
  }

  // ---------- Images ----------
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image illisible'));
      img.src = src;
    });
  }
  // Redimensionne et réencode en JPEG. Le réencodage supprime les métadonnées EXIF (dont la position GPS).
  function toJpeg(img, maxSide, quality, as = 'dataurl') {
    const ratio = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * ratio);
    const h = Math.round(img.naturalHeight * ratio);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    if (as === 'blob') return new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
    return c.toDataURL('image/jpeg', quality);
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    const room = MAX_PHOTOS - state.photos.length;
    if (!files.length) return;
    if (files.length > room) toast(`${MAX_PHOTOS} photos maximum, ${Math.max(room, 0)} ajoutée(s)`);
    for (const file of files.slice(0, Math.max(room, 0))) {
      const p = { id: uid(), file, url: URL.createObjectURL(file), apiData: '', error: '' };
      state.photos.push(p);
    }
    render();
    for (const p of state.photos.filter((x) => !x.apiData && !x.error)) {
      try {
        const img = await loadImage(p.url);
        p.apiData = toJpeg(img, 1024, 0.82);
      } catch (e) {
        p.error = 'Format non lu par ce navigateur';
      }
    }
    const bad = state.photos.filter((p) => p.error);
    if (bad.length) {
      state.photos = state.photos.filter((p) => !p.error);
      toast(`${bad.length} photo(s) illisible(s) retirée(s). Utilisez du JPEG ou PNG.`);
    }
    render();
  }

  // ---------- OpenRouter ----------
  class ApiError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }

  async function checkKey(key) {
    const res = await fetch(`${OPENROUTER}/key`, { headers: { Authorization: `Bearer ${key}` } });
    if (res.status === 401) throw new ApiError("Cette clé est refusée par OpenRouter. Vérifiez qu'elle est complète.", 401);
    if (!res.ok) throw new ApiError(`OpenRouter répond ${res.status}. Réessayez dans un instant.`, res.status);
    return res.json();
  }

  async function chat(role, messages, { temperature = 0.4, maxTokens = 2500 } = {}) {
    const body = {
      model: model(role), messages, temperature, max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      // N'envoie la requête qu'aux fournisseurs qui respectent le format JSON.
      provider: { require_parameters: true },
    };
    let res = await post(body);
    // Aucun fournisseur ne respecte le format JSON imposé : on retente sans.
    if (res.status === 400 || res.status === 404) {
      const txt = await res.clone().text();
      if (/response_format|json|provider|endpoint/i.test(txt)) { delete body.response_format; delete body.provider; res = await post(body); }
    }
    const data = await readResponse(res);
    let content = data.choices?.[0]?.message?.content;
    if (Array.isArray(content)) content = content.map((c) => c.text || '').join('');
    return parseJson(content || '');
  }

  // Produit une image à partir d'une photo et d'une consigne. Renvoie une URL data:.
  async function generateImage(photoData, prompt) {
    const body = {
      model: model('image'),
      modalities: ['image'],
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: photoData } }] }],
      image_config: { aspect_ratio: '4:3' },
    };
    let res = await post(body);
    if (res.status === 400) {
      // Réglage d'image refusé par ce modèle : on retente avec ses valeurs par défaut.
      delete body.image_config;
      res = await post(body);
    }
    const data = await readResponse(res);
    const msg = data.choices?.[0]?.message || {};
    let url = msg.images?.[0]?.image_url?.url;
    if (!url && Array.isArray(msg.content)) url = msg.content.find((c) => c.type === 'image_url')?.image_url?.url;
    if (!url) throw new ApiError("Le modèle n'a pas renvoyé d'image. Réessayez ou changez de modèle d'image dans les réglages.");
    return url;
  }

  function post(b) {
    return fetch(`${OPENROUTER}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': location.origin + location.pathname,
        'X-Title': 'Assistant annonce Leboncoin',
      },
      body: JSON.stringify(b),
    });
  }

  async function readResponse(res) {
    if (!res.ok) {
      let msg = '';
      try { msg = (await res.json()).error?.message || ''; } catch (e) { /* corps non JSON */ }
      if (res.status === 401) throw new ApiError('Clé API refusée. Saisissez-la de nouveau dans les réglages.', 401);
      if (res.status === 402) throw new ApiError("Crédit OpenRouter insuffisant. Rechargez votre compte sur openrouter.ai/credits.", 402);
      if (res.status === 429) throw new ApiError('Trop de requêtes. Patientez quelques secondes puis réessayez.', 429);
      throw new ApiError(`Erreur OpenRouter ${res.status}${msg ? ' : ' + msg : ''}`, res.status);
    }
    const data = await res.json();
    if (data.error) throw new ApiError(data.error.message || 'Réponse invalide', data.error.code);
    return data;
  }

  function parseJson(text) {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(cleaned); } catch (e) { /* on tente l'extraction */ }
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)); } catch (e) { /* échec */ }
    }
    throw new ApiError("Le modèle n'a pas renvoyé une réponse exploitable. Réessayez ou changez de modèle dans les réglages.");
  }

  const imageParts = (photos, n) => photos.filter((p) => p.apiData).slice(0, n)
    .map((p) => ({ type: 'image_url', image_url: { url: p.apiData } }));

  const ANALYSIS_PROMPT = `Tu es un expert de la revente d'occasion entre particuliers sur Leboncoin, en France.
On te montre les photos d'un objet à vendre. Extrais le maximum d'informations fiables À PARTIR DES PHOTOS : type d'objet, marque (logos, étiquettes, gravures), modèle ou référence (plaques, étiquettes, textes visibles), couleur, matières, dimensions estimées, caractéristiques techniques lisibles, accessoires présents, défauts visibles (rayures, taches, usure, pièces manquantes).
N'invente rien : si une info n'est pas visible, laisse une chaîne vide. Précise "environ" pour toute estimation.
Ensuite, prépare 3 à 5 questions courtes pour le vendeur, sur ce que les photos ne montrent pas et qui aide à vendre : fonctionnement, ancienneté, facture ou garantie, taille ou pointure, raison de la vente, accessoires non visibles, etc. Ne demande PAS le prix, l'état général, la remise en main propre ni l'envoi (déjà demandés ailleurs). Préfère des questions à choix avec 2 à 5 options courtes quand c'est possible.
Réponds uniquement avec un objet JSON de cette forme :
{
  "objet": "nom courant de l'objet, tel qu'un acheteur le chercherait",
  "categorie": "catégorie Leboncoin la plus adaptée (ex. Électroménager, Ameublement, Vêtements, Jeux & Jouets, Vélos, Informatique...)",
  "marque": "",
  "modele": "",
  "couleur": "",
  "matieres": "",
  "dimensions": "",
  "caracteristiques": ["faits techniques courts"],
  "accessoires_visibles": [""],
  "defauts_visibles": [""],
  "etat_estime": "neuf | tres_bon | bon | satisfaisant | pieces",
  "usage": "2 phrases : à quoi sert l'objet et comment on s'en sert",
  "prix_neuf_estime": 0,
  "fourchette_prix": { "min": 0, "max": 0 },
  "poids_estime_kg": 0,
  "confiance": "faible | moyenne | haute",
  "questions": [
    { "id": "q1", "question": "", "type": "choix | texte", "options": [""] }
  ]
}
La fourchette de prix correspond au prix de revente réaliste d'occasion en France, en euros.`;

  async function runAnalysis() {
    state.step = 'analyzing'; state.error = ''; render();
    try {
      const userText = state.hint.trim()
        ? `Précision du vendeur : ${state.hint.trim()}`
        : "Le vendeur n'a pas donné de précision.";
      const res = await chat('vision', [
        { role: 'system', content: ANALYSIS_PROMPT },
        { role: 'user', content: [{ type: 'text', text: userText }, ...imageParts(state.photos, MAX_PHOTOS)] },
      ], { temperature: 0.2 });
      state.analysis = normalizeAnalysis(res);
      for (const k of Object.keys(state.facts)) state.facts[k] = state.analysis[k] || '';
      state.answers = {};
      if (!state.details.etat && etatById(state.analysis.etat_estime)) state.details.etat = state.analysis.etat_estime;
      if (!state.details.prix && state.analysis.fourchette_prix.max > 0) {
        const { min, max } = state.analysis.fourchette_prix;
        state.details.prix = String(Math.round((min + max) / 2));
      }
      state.step = 'questions';
    } catch (e) {
      handleError(e, 'photos');
    }
    render();
  }

  function normalizeAnalysis(r) {
    const arr = (v) => (Array.isArray(v) ? v.filter((x) => x && String(x).trim()).map(String) : []);
    const num = (v) => { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; };
    const qs = (Array.isArray(r.questions) ? r.questions : []).slice(0, 5).map((q, i) => ({
      id: 'q' + (i + 1),
      question: String(q.question || '').trim(),
      type: q.type === 'choix' && arr(q.options).length ? 'choix' : 'texte',
      options: arr(q.options).slice(0, 6),
    })).filter((q) => q.question);
    return {
      objet: String(r.objet || ''), categorie: String(r.categorie || ''), marque: String(r.marque || ''),
      modele: String(r.modele || ''), couleur: String(r.couleur || ''), matieres: String(r.matieres || ''),
      dimensions: String(r.dimensions || ''),
      caracteristiques: arr(r.caracteristiques), accessoires_visibles: arr(r.accessoires_visibles),
      defauts_visibles: arr(r.defauts_visibles),
      etat_estime: String(r.etat_estime || '').trim(),
      usage: String(r.usage || ''),
      prix_neuf_estime: num(r.prix_neuf_estime),
      fourchette_prix: { min: num(r.fourchette_prix?.min), max: num(r.fourchette_prix?.max) },
      poids_estime_kg: num(r.poids_estime_kg),
      confiance: String(r.confiance || ''),
      questions: qs,
    };
  }

  const WRITING_PROMPT = `Tu rédiges des annonces Leboncoin qui se vendent vite. Tu écris comme un particulier français soigneux et honnête, pas comme un robot ni comme une publicité.

STYLE, règles strictes :
- Jamais de tiret cadratin ni demi-cadratin. Utilise des virgules, des points, des deux-points ou des parenthèses.
- Jamais d'émoji, de symbole décoratif, de markdown (pas d'astérisques, pas de dièses), pas de guillemets typographiques, pas de caractère unique pour les points de suspension.
- Mots et tournures interdits : incontournable, véritable allié, compagnon idéal, sublimer, alliant, n'hésitez pas, ne manquez pas, que vous soyez, plongez, découvrez, offrez-vous, élégance intemporelle, design épuré, en somme, qualité exceptionnelle, parfait pour, idéal pour tous, un must.
- Au plus un point d'exclamation dans toute l'annonce.
- Phrases courtes, concrètes. Des faits vérifiables (marque, dimensions, capacité, ce qui est inclus) plutôt que des adjectifs.
- Vouvoiement.
- N'invente rien. Une info absente des données ne doit pas être affirmée.

TITRE, référencement Leboncoin :
- Entre 35 et 70 caractères, jamais plus de 100.
- Commence par le mot que l'acheteur tape dans la barre de recherche (le type d'objet), puis la marque, le modèle ou la référence, puis 1 ou 2 attributs décisifs (taille, capacité, couleur, pointure, puissance, âge).
- Exemple de forme : "Vélo électrique Rockrider E-ST 100 taille M" ou "Poussette Yoyo 2 Babyzen noire avec nacelle".
- Interdit dans le titre : "vends", "à vendre", "super affaire", "urgent", "top", le prix, les majuscules pleines, la ponctuation finale, les deux-points. N'ajoute l'état que s'il est neuf ("neuf" est un mot recherché).

DESCRIPTION, entre 600 et 1400 caractères, texte brut avec des retours à la ligne :
1. Première phrase : ce que c'est exactement, avec type, marque et modèle. C'est elle que l'acheteur lit dans l'aperçu, elle doit donner envie de cliquer.
2. Un court paragraphe sur l'état, rédigé selon la CONSIGNE D'ÉTAT fournie, précis sur les défauts éventuels.
3. La ligne "Caractéristiques :" suivie de 3 à 7 lignes qui commencent par "- ".
4. Une ou deux phrases sur l'utilisation concrète : à quoi ça sert, comment on s'en sert au quotidien.
5. Ce qui est fourni avec.
6. Les modalités : remise en main propre (avec la ville si fournie) et/ou envoi, exactement selon les données.
7. Une phrase de fin courte et naturelle, par exemple "Je réponds rapidement aux messages."
Glisse naturellement 2 ou 3 synonymes que les acheteurs tapent (par exemple "commode" et "meuble de rangement"), sans liste de mots-clés en vrac.

Réponds uniquement avec un objet JSON de cette forme :
{
  "titre": "",
  "description": "",
  "accroche": "une phrase de 15 mots maximum qui résume pourquoi c'est une bonne affaire",
  "utilisation": { "resume": "2 phrases simples qui expliquent comment on se sert de l'objet", "etapes": ["3 à 5 étapes courtes, à l'infinitif"] },
  "points_forts": ["3 à 5 points forts de 8 mots maximum"],
  "caracteristiques": [{ "nom": "Marque", "valeur": "" }],
  "prix_conseille": 0,
  "categorie": "catégorie Leboncoin"
}`;

  async function runWriting() {
    state.step = 'generating'; state.error = ''; render();
    try {
      const etat = etatById(state.details.etat);
      const a = state.analysis || {};
      const questions = (a.questions || []).map((q) => ({ question: q.question, reponse: (state.answers[q.id] || '').trim() }))
        .filter((q) => q.reponse);
      const data = {
        objet: state.facts,
        precision_du_vendeur: state.hint.trim(),
        caracteristiques_vues_sur_photos: a.caracteristiques,
        accessoires_visibles: a.accessoires_visibles,
        defauts_visibles: a.defauts_visibles,
        usage_estime: a.usage,
        reponses_du_vendeur: questions,
        etat: etat ? etat.label : '',
        CONSIGNE_ETAT: etat ? etat.consigne : '',
        prix_demande: formatPrice(state.details.prix) || 'non fixé, propose un prix conseillé',
        fourchette_prix_estimee: a.fourchette_prix,
        prix_neuf_estime: a.prix_neuf_estime || null,
        remise_en_main_propre: state.details.mainPropre,
        ville: state.details.mainPropre ? state.details.ville.trim() : '',
        envoi_possible: state.details.envoi,
        infos_libres_du_vendeur: state.details.notes.trim(),
      };
      const res = await chat('text', [
        { role: 'system', content: WRITING_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Données de l\'annonce (JSON) :\n' + JSON.stringify(data, null, 2) },
            ...imageParts(state.photos, 4),
          ],
        },
      ], { temperature: 0.6 });
      state.ad = normalizeAd(res);
      if (!state.details.prix && state.ad.prix_conseille) state.details.prix = String(state.ad.prix_conseille);
      state.tab = 'apercu';
      state.step = 'annonce';
    } catch (e) {
      handleError(e, 'details');
    }
    render();
    window.scrollTo(0, 0);
  }

  function normalizeAd(r) {
    const arr = (v) => (Array.isArray(v) ? v : []);
    const ad = {
      titre: humanizeTitle(r.titre || ''),
      description: humanize(r.description || '').slice(0, DESC_MAX),
      accroche: humanize(r.accroche || ''),
      utilisation: {
        resume: humanize(r.utilisation?.resume || ''),
        etapes: arr(r.utilisation?.etapes).map((s) => humanize(String(s)).replace(/^-\s*/, '')).filter(Boolean).slice(0, 6),
      },
      points_forts: arr(r.points_forts).map((s) => humanize(String(s)).replace(/^-\s*/, '')).filter(Boolean).slice(0, 6),
      caracteristiques: arr(r.caracteristiques)
        .map((c) => ({ nom: humanize(String(c?.nom || '')), valeur: humanize(String(c?.valeur || '')) }))
        .filter((c) => c.nom && c.valeur).slice(0, 10),
      prix_conseille: Math.round(Number(r.prix_conseille)) || 0,
      categorie: humanize(r.categorie || state.facts.categorie || ''),
    };
    if (!ad.titre) throw new ApiError("Le modèle n'a pas produit de titre. Réessayez.");
    return ad;
  }

  const ENHANCE_PROMPT = (objet) => `Edit this photo into a clean, professional cover photo for a second-hand marketplace listing${objet ? ` (the item is: ${objet})` : ''}.
Keep the exact same item: same shape, proportions, colors, brand markings, and any visible wear, scratches or defects. Do not add, remove or modify any part of the item.
Do not add text, logos, watermarks, props, hands or people.
Center the item on a plain light neutral background, soft even studio lighting, subtle natural shadow, sharp focus, photorealistic.`;

  async function runEnhance() {
    const source = state.photos.find((p) => !p.generated && p.apiData);
    if (!source) return;
    state.enhance = { busy: true, url: '', error: '' };
    render();
    try {
      const objet = [state.facts.objet, state.facts.marque, state.facts.modele].filter(Boolean).join(' ');
      state.enhance.url = await generateImage(source.apiData, ENHANCE_PROMPT(objet));
    } catch (e) {
      console.error(e);
      if (e instanceof ApiError && e.status === 401) { handleError(e, 'annonce'); state.enhance.busy = false; render(); return; }
      state.enhance.error = e instanceof TypeError ? 'Connexion à OpenRouter impossible.' : e.message;
    }
    state.enhance.busy = false;
    render();
  }

  function enhanceCard() {
    const en = state.enhance;
    const current = state.photos.find((p) => p.generated);
    let body;
    if (en.busy) {
      body = `<div class="loading" style="padding:16px 0"><div class="spinner" aria-hidden="true"></div>
        <p class="muted" style="margin:0">Création en cours avec ${esc(modelLabel('image'))}, 20 à 60 secondes.</p></div>`;
    } else if (en.url) {
      body = `<img src="${en.url}" alt="Photo mise en valeur" style="border-radius:12px;width:100%;margin-bottom:10px">
        <div class="export-grid">
          <button class="btn" id="btn-enhance-use">Mettre en couverture</button>
          <button class="btn secondary" id="btn-enhance-retry">Autre essai</button>
          <button class="btn ghost" id="btn-enhance-drop">Ignorer</button>
        </div>`;
    } else if (current) {
      body = `<p class="muted" style="margin:0 0 10px">Une photo retouchée est en couverture. Vos photos d'origine suivent.</p>
        <div class="export-grid">
          <button class="btn secondary" id="btn-enhance-retry">Refaire la photo</button>
          <button class="btn ghost" id="btn-enhance-remove">Retirer la photo retouchée</button>
        </div>`;
    } else {
      body = `<p class="muted" style="margin:0 0 10px">Détoure l'objet de votre première photo sur un fond clair, avec un éclairage de studio. L'objet reste identique, défauts compris.</p>
        <button class="btn secondary block" id="btn-enhance-retry">Créer la photo mise en valeur</button>`;
    }
    return `<div class="card">
      <h2>Photo de couverture mise en valeur</h2>
      ${en.error ? `<div class="error-box" role="alert">${esc(en.error)}</div>` : ''}
      ${body}
      <p class="muted small" style="margin:10px 0 0">Une image générée coûte plus cher que le texte, environ quelques centimes à 0,20 $. Gardez vos vraies photos à la suite : l'acheteur doit voir l'objet réel.</p>
    </div>`;
  }

  function handleError(e, backTo) {
    console.error(e);
    if (e instanceof ApiError && e.status === 401) {
      store.del(STORAGE_KEY);
      state.error = e.message;
      state.step = 'key';
      return;
    }
    state.error = e instanceof TypeError
      ? 'Connexion à OpenRouter impossible. Vérifiez votre réseau puis réessayez.'
      : e.message || String(e);
    state.step = backTo;
  }

  // ---------- Export ----------
  function adAsText() {
    const d = state.details;
    const etat = etatById(d.etat);
    const lines = [
      'TITRE', state.ad.titre, '',
      'PRIX', formatPrice(d.prix) || 'à définir', '',
      'CATÉGORIE', state.ad.categorie || '-', '',
      'ÉTAT', etat ? etat.label : '-', '',
      'REMISE EN MAIN PROPRE', d.mainPropre ? 'Oui' + (d.ville.trim() ? ' (' + d.ville.trim() + ')' : '') : 'Non', '',
      'ENVOI', d.envoi ? 'Oui' : 'Non', '',
      'DESCRIPTION', state.ad.description, '',
    ];
    return lines.join('\n');
  }

  async function exportPhotos() {
    const out = [];
    const slug = slugify(state.ad.titre);
    let i = 0;
    for (const p of state.photos) {
      i += 1;
      const img = await loadImage(p.url);
      const blob = await toJpeg(img, 2048, 0.9, 'blob');
      out.push({ name: `${String(i).padStart(2, '0')}-${slug}.jpg`, blob });
    }
    return out;
  }

  async function previewHtml() {
    const imgs = [];
    for (const p of state.photos) imgs.push(toJpeg(await loadImage(p.url), 1200, 0.85));
    const css = await fetch('css/app.css').then((r) => r.text()).catch(() => '');
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(state.ad.titre)}</title><style>${css}</style></head>
<body><main class="app" style="padding-bottom:32px">${adPreviewHtml(imgs)}</main>
<script>${galleryScript.toString()};galleryScript(document);</script></body></html>`;
  }

  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }

  async function downloadAll(btn) {
    btn.disabled = true;
    const label = btn.innerHTML;
    btn.textContent = 'Préparation...';
    try {
      const slug = slugify(state.ad.titre);
      const photos = await exportPhotos();
      const html = await previewHtml();
      if (window.JSZip) {
        const zip = new window.JSZip();
        zip.file('annonce.txt', adAsText());
        zip.file('titre.txt', state.ad.titre);
        zip.file('description.txt', state.ad.description);
        zip.file('apercu.html', html);
        const folder = zip.folder('photos');
        photos.forEach((p) => folder.file(p.name, p.blob));
        const blob = await zip.generateAsync({ type: 'blob' });
        downloadBlob(blob, `annonce-${slug}.zip`);
      } else {
        // Bibliothèque ZIP non chargée : fichiers séparés.
        downloadBlob(new Blob([adAsText()], { type: 'text/plain;charset=utf-8' }), `annonce-${slug}.txt`);
        for (const p of photos) { downloadBlob(p.blob, p.name); await new Promise((r) => setTimeout(r, 350)); }
      }
      toast('Téléchargement lancé');
    } catch (e) {
      console.error(e);
      toast('Échec du téléchargement : ' + e.message);
    }
    btn.disabled = false;
    btn.innerHTML = label;
  }

  async function shareAll(btn) {
    btn.disabled = true;
    try {
      const photos = await exportPhotos();
      const files = photos.map((p) => new File([p.blob], p.name, { type: 'image/jpeg' }));
      const payload = { title: state.ad.titre, text: `${state.ad.titre}\n${formatPrice(state.details.prix)}\n\n${state.ad.description}`, files };
      if (navigator.canShare && navigator.canShare(payload)) await navigator.share(payload);
      else await navigator.share({ title: payload.title, text: payload.text });
    } catch (e) {
      if (e.name !== 'AbortError') toast('Partage impossible sur cet appareil');
    }
    btn.disabled = false;
  }

  // ---------- Rendu ----------
  const STEP_OF = { photos: 0, analyzing: 0, questions: 1, details: 2, generating: 2, annonce: 3 };

  let lastStep = '';
  function render() {
    const hasKey = !!apiKey();
    if (!hasKey) state.step = 'key';
    if (state.step !== lastStep) { lastStep = state.step; window.scrollTo(0, 0); }
    $('#btn-settings').hidden = !hasKey;
    const stepper = $('#stepper');
    stepper.hidden = state.step === 'key';
    const idx = STEP_OF[state.step] ?? 0;
    $$('li', stepper).forEach((li, i) => {
      li.classList.toggle('current', i === idx);
      li.classList.toggle('done', i < idx);
    });
    const views = { key: viewKey, photos: viewPhotos, analyzing: viewAnalyzing, questions: viewQuestions, details: viewDetails, generating: viewGenerating, annonce: viewAnnonce };
    const focused = document.activeElement && document.activeElement.id;
    app.innerHTML = `<div class="screen">${views[state.step]()}</div>`;
    bind[state.step] && bind[state.step]();
    if (focused && $('#' + focused)) $('#' + focused).focus({ preventScroll: true });
  }

  function errorBox() {
    return state.error ? `<div class="error-box" role="alert">${esc(state.error)}</div>` : '';
  }

  function actionbar(inner) {
    return `<div class="actionbar"><div class="inner">${inner}</div></div>`;
  }

  // --- Clé API ---
  function viewKey() {
    return `
      <div class="welcome">
        <div class="hero"><img src="icon.svg" alt="" width="76" height="76"></div>
        <h1>Votre annonce Leboncoin en 3 minutes</h1>
        <p class="lead">Prenez l'objet en photo, répondez à quelques questions : titre, description et prix sont rédigés pour vous.</p>
      </div>
      ${errorBox()}
      <form class="card" id="key-form" autocomplete="off">
        <h2>Votre clé OpenRouter</h2>
        <label class="field">
          <span class="label">Clé API</span>
          <div class="input-group">
            <input class="input" id="key-input" type="password" inputmode="text" autocapitalize="off" spellcheck="false"
              placeholder="sk-or-v1-..." required>
            <button class="btn ghost small suffix" type="button" id="key-toggle">Voir</button>
          </div>
          <span class="hint">Enregistrée dans ce navigateur uniquement, sans date d'expiration. Elle n'est envoyée qu'à OpenRouter.</span>
        </label>
        <button class="btn block" type="submit" id="key-submit">Enregistrer et commencer</button>
      </form>
      <div class="card">
        <h2>Pas encore de clé ?</h2>
        <ol class="steps-list">
          <li>Créez un compte sur <a href="https://openrouter.ai" target="_blank" rel="noopener">openrouter.ai</a>.</li>
          <li>Ajoutez quelques euros de crédit : une annonce coûte moins d'un centime avec le modèle par défaut.</li>
          <li>Créez une clé sur <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a> et collez-la ci-dessus.</li>
        </ol>
      </div>`;
  }

  // --- Photos ---
  function viewPhotos() {
    const n = state.photos.length;
    const ready = n > 0 && state.photos.every((p) => p.apiData);
    return `
      <h1>Photographiez votre objet</h1>
      <p class="lead">Ajoutez 3 à 10 photos : vue d'ensemble, détails, étiquette ou référence, défauts éventuels. Plus il y en a, plus l'annonce est précise.</p>
      ${errorBox()}
      <label class="dropzone" id="dropzone">
        <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true"><path fill="currentColor" d="M9 3 7.2 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9zm3 15a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/></svg>
        <strong>${n ? 'Ajouter d\'autres photos' : 'Ajouter des photos'}</strong>
        <span class="muted">${n}/${MAX_PHOTOS} photo${n > 1 ? 's' : ''}</span>
        <input type="file" id="file-input" accept="image/*" multiple hidden>
        <span class="row">
          <button type="button" class="btn small" id="btn-camera">Prendre une photo</button>
          <button type="button" class="btn small secondary" id="btn-gallery">Galerie</button>
        </span>
        <input type="file" id="camera-input" accept="image/*" capture="environment" hidden>
      </label>
      ${n ? `<div class="photo-grid">${state.photos.map((p, i) => `
        <div class="photo ${p.apiData ? '' : 'processing'}" data-id="${p.id}" role="button" tabindex="0" aria-label="Photo ${i + 1}${i ? ', toucher pour mettre en couverture' : ', couverture'}">
          <img src="${p.url}" alt="">
          ${i === 0 ? '<span class="badge">Couverture</span>' : ''}
          <button class="remove" type="button" data-remove="${p.id}" aria-label="Retirer la photo ${i + 1}">×</button>
        </div>`).join('')}</div>
        <p class="muted small">Touchez une photo pour la mettre en couverture.</p>` : ''}
      <div class="card" style="margin-top:14px">
        <label class="field" style="margin:0">
          <span class="label">En quelques mots, c'est quoi ? <span class="muted">(facultatif)</span></span>
          <input class="input" id="hint" value="${esc(state.hint)}" placeholder="Ex. machine à café Delonghi achetée en 2023">
          <span class="hint">Aide l'analyse si l'objet est difficile à reconnaître.</span>
        </label>
      </div>
      ${actionbar(`<button class="btn" id="btn-analyze" ${ready ? '' : 'disabled'}>${n && !ready ? 'Préparation des photos...' : 'Analyser les photos'}</button>`)}`;
  }

  function viewAnalyzing() {
    return loadingView('vision', 'Analyse des photos en cours', [
      'Lecture des photos', "Identification de l'objet et de la marque", 'Repérage des détails et défauts', 'Estimation du prix de revente',
    ]);
  }
  function viewGenerating() {
    return loadingView('text', "Rédaction de l'annonce", [
      'Choix des mots-clés recherchés', 'Écriture du titre', 'Rédaction de la description', "Relecture et mise en forme",
    ]);
  }
  function loadingView(role, title, steps) {
    return `<div class="loading card">
      <div class="spinner" aria-hidden="true"></div>
      <h2>${title}</h2>
      <p class="muted">Environ 10 à 30 secondes avec ${esc(modelLabel(role))}.</p>
      <ol class="steps" id="loading-steps">${steps.map((s, i) => `<li class="${i === 0 ? 'on' : ''}">${s}</li>`).join('')}</ol>
    </div>`;
  }
  function modelLabel(role) {
    const m = ROLES[role].models.find((x) => x.id === model(role));
    return m ? m.label.replace(/\s*\(.*\)/, '') : model(role);
  }

  // --- Questions ---
  function viewQuestions() {
    const a = state.analysis;
    const f = state.facts;
    const conf = { haute: ['ok', 'confiance haute'], moyenne: ['warn', 'confiance moyenne'], faible: ['warn', 'confiance faible'] }[a.confiance];
    const factField = (k, label, ph) => `
      <label class="field"><span class="label">${label}</span>
        <input class="input" data-fact="${k}" value="${esc(f[k])}" placeholder="${esc(ph)}"></label>`;
    return `
      <h1>Voici ce que j'ai repéré</h1>
      <p class="lead">Corrigez si besoin, puis répondez aux questions : chaque réponse rend l'annonce plus convaincante.</p>
      ${errorBox()}
      <div class="card">
        <h2>L'objet ${conf ? `<span class="chip ${conf[0]} confidence">${conf[1]}</span>` : ''}</h2>
        <div class="facts">
          ${factField('objet', 'Objet', 'Ex. Machine à café à grain')}
          ${factField('marque', 'Marque', 'Inconnue')}
          ${factField('modele', 'Modèle ou référence', 'Inconnu')}
          ${factField('categorie', 'Catégorie Leboncoin', 'Ex. Électroménager')}
          ${factField('couleur', 'Couleur', '')}
          ${factField('dimensions', 'Dimensions', 'Ex. 30 x 20 x 40 cm')}
        </div>
        ${factField('matieres', 'Matières', '')}
        ${a.caracteristiques.length ? `<p class="label" style="font-weight:600;margin:4px 0 8px">Détails lus sur les photos</p>
          <div class="chips">${a.caracteristiques.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>` : ''}
        ${a.accessoires_visibles.length ? `<p style="font-weight:600;margin:14px 0 8px">Fourni avec</p>
          <div class="chips">${a.accessoires_visibles.map((c) => `<span class="chip ok">${esc(c)}</span>`).join('')}</div>` : ''}
        ${a.defauts_visibles.length ? `<p style="font-weight:600;margin:14px 0 8px">Défauts visibles</p>
          <div class="chips">${a.defauts_visibles.map((c) => `<span class="chip warn">${esc(c)}</span>`).join('')}</div>
          <p class="muted small" style="margin:6px 0 0">Ils seront mentionnés honnêtement : cela évite les négociations au rendez-vous.</p>` : ''}
      </div>
      ${a.questions.length ? `<div class="card">
        <h2>Quelques questions</h2>
        ${a.questions.map((q) => questionField(q)).join('')}
      </div>` : ''}
      ${actionbar(`<button class="btn secondary" id="btn-back">Retour</button><button class="btn" id="btn-next">Continuer</button>`)}`;
  }

  function questionField(q) {
    const val = state.answers[q.id] || '';
    if (q.type === 'choix') {
      const other = val && !q.options.includes(val);
      return `<fieldset class="field" style="border:0;padding:0;margin:0 0 18px">
        <legend class="label" style="font-weight:600;margin-bottom:8px">${esc(q.question)}</legend>
        <div class="choices inline">
          ${q.options.map((o) => `<label class="choice"><input type="radio" name="${q.id}" value="${esc(o)}" ${val === o ? 'checked' : ''}>
            <span class="box">${esc(o)}</span></label>`).join('')}
        </div>
        <input class="input" style="margin-top:8px" data-answer="${q.id}" data-other="1" placeholder="Autre réponse (facultatif)" value="${other ? esc(val) : ''}">
      </fieldset>`;
    }
    return `<label class="field"><span class="label">${esc(q.question)}</span>
      <input class="input" data-answer="${q.id}" value="${esc(val)}" placeholder="Votre réponse (facultatif)"></label>`;
  }

  // --- Détails ---
  function viewDetails() {
    const d = state.details;
    const a = state.analysis || { fourchette_prix: {} };
    const fp = a.fourchette_prix || {};
    const suggestions = fp.max > 0 ? [fp.min, Math.round((fp.min + fp.max) / 2), fp.max].filter((v, i, arr) => v > 0 && arr.indexOf(v) === i) : [];
    return `
      <h1>État, prix et remise</h1>
      <p class="lead">Ces choix adaptent le ton de l'annonce : un objet neuf ne se présente pas comme un objet à réparer.</p>
      ${errorBox()}
      <div class="card">
        <fieldset style="border:0;padding:0;margin:0">
          <legend class="label" style="font-weight:600;margin-bottom:8px">État de l'objet</legend>
          <div class="choices">
            ${ETATS.map((e) => `<label class="choice"><input type="radio" name="etat" value="${e.id}" ${d.etat === e.id ? 'checked' : ''}>
              <span class="box"><strong>${e.label}</strong><small>${e.desc}</small></span></label>`).join('')}
          </div>
          ${a.etat_estime && etatById(a.etat_estime) ? `<p class="muted small" style="margin:8px 0 0">D'après les photos : ${etatById(a.etat_estime).label.toLowerCase()}.</p>` : ''}
        </fieldset>
      </div>
      <div class="card">
        <label class="field" style="margin-bottom:${suggestions.length ? '10px' : '0'}">
          <span class="label">Prix de vente</span>
          <div class="price-wrap"><input class="input price-input" id="prix" type="text" inputmode="decimal" value="${esc(d.prix)}" placeholder="0"></div>
          ${fp.max > 0 ? `<span class="hint">Prix constaté en occasion : ${fp.min} à ${fp.max} €${a.prix_neuf_estime ? `, neuf environ ${a.prix_neuf_estime} €` : ''}.</span>` : '<span class="hint">Laissez vide pour obtenir un prix conseillé.</span>'}
        </label>
        ${suggestions.length ? `<div class="chips">${suggestions.map((v) => `<button type="button" class="chip orange" data-price="${v}" style="border:0;cursor:pointer;min-height:36px">${v} €</button>`).join('')}</div>` : ''}
      </div>
      <div class="card">
        <h2>Remise de l'objet</h2>
        <label class="toggle"><span class="txt"><strong>Remise en main propre</strong><small>L'acheteur vient chercher l'objet</small></span>
          <input type="checkbox" id="mainPropre" ${d.mainPropre ? 'checked' : ''}><span class="sw" aria-hidden="true"></span></label>
        <div class="sub-field" id="ville-field" ${d.mainPropre ? '' : 'hidden'}>
          <label class="field" style="margin:0"><span class="label">Ville ou quartier <span class="muted">(facultatif)</span></span>
            <input class="input" id="ville" value="${esc(d.ville)}" placeholder="Ex. Lyon 3e" autocomplete="address-level2"></label>
        </div>
        <label class="toggle"><span class="txt"><strong>Envoi possible</strong><small>Expédition par colis${a.poids_estime_kg ? `, poids estimé ${a.poids_estime_kg} kg` : ''}</small></span>
          <input type="checkbox" id="envoi" ${d.envoi ? 'checked' : ''}><span class="sw" aria-hidden="true"></span></label>
      </div>
      <div class="card">
        <label class="field" style="margin:0"><span class="label">Autre chose à dire ? <span class="muted">(facultatif)</span></span>
          <textarea class="textarea" id="notes" placeholder="Ex. facture disponible, cause déménagement, prix ferme, animaux à la maison...">${esc(d.notes)}</textarea></label>
      </div>
      ${!d.mainPropre && !d.envoi ? '<div class="info-box">Cochez au moins un mode de remise, sinon l\'acheteur ne saura pas comment récupérer l\'objet.</div>' : ''}
      ${actionbar(`<button class="btn secondary" id="btn-back">Retour</button><button class="btn" id="btn-write" ${d.etat && (d.mainPropre || d.envoi) ? '' : 'disabled'}>Rédiger l'annonce</button>`)}`;
  }

  // --- Annonce ---
  function adPreviewHtml(imgs) {
    const ad = state.ad;
    const d = state.details;
    const etat = etatById(d.etat);
    const specs = ad.caracteristiques.length ? ad.caracteristiques : [];
    return `<article class="ad">
      ${imgs.length ? `<div class="gallery"><div class="track" data-track>${imgs.map((src, i) => `<img src="${src}" alt="Photo ${i + 1} : ${esc(ad.titre)}" loading="${i ? 'lazy' : 'eager'}">`).join('')}</div>
        <span class="count" data-count>1/${imgs.length}</span></div>
        ${imgs.length > 1 ? `<div class="thumbs">${imgs.map((src, i) => `<button type="button" data-thumb="${i}" class="${i ? '' : 'on'}" aria-label="Voir la photo ${i + 1}"><img src="${src}" alt=""></button>`).join('')}</div>` : ''}` : ''}
      <div class="ad-body">
        <h2 class="ad-title">${esc(ad.titre)}</h2>
        <p class="ad-price">${esc(formatPrice(d.prix) || 'Prix à définir')}</p>
        <div class="ad-meta">
          ${etat ? `<span class="chip orange">${esc(etat.label)}</span>` : ''}
          ${ad.categorie ? `<span class="chip">${esc(ad.categorie)}</span>` : ''}
          ${d.mainPropre ? `<span class="chip ok">Main propre${d.ville.trim() ? ' à ' + esc(d.ville.trim()) : ''}</span>` : ''}
          ${d.envoi ? '<span class="chip ok">Envoi possible</span>' : ''}
        </div>
        ${ad.accroche ? `<p style="margin:0;font-weight:600">${esc(ad.accroche)}</p>` : ''}
        ${ad.points_forts.length ? `<section class="ad-section"><h3>Points forts</h3>
          <ul class="highlights">${ad.points_forts.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></section>` : ''}
        ${ad.utilisation.resume || ad.utilisation.etapes.length ? `<section class="ad-section"><h3>Comment ça s'utilise</h3>
          ${ad.utilisation.resume ? `<p style="margin:0;color:var(--ink-2)">${esc(ad.utilisation.resume)}</p>` : ''}
          ${ad.utilisation.etapes.length ? `<ol class="usage-steps">${ad.utilisation.etapes.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}</section>` : ''}
        <section class="ad-section"><h3>Description</h3><p class="ad-desc">${esc(ad.description)}</p></section>
        ${specs.length ? `<section class="ad-section"><h3>Caractéristiques</h3>
          <dl class="specs">${specs.map((c) => `<dt>${esc(c.nom)}</dt><dd>${esc(c.valeur)}</dd>`).join('')}</dl></section>` : ''}
        <section class="ad-section"><h3>Remise</h3><div class="delivery">
          <div><span class="dot ${d.mainPropre ? '' : 'off'}"></span>Remise en main propre : ${d.mainPropre ? 'oui' + (d.ville.trim() ? ', ' + esc(d.ville.trim()) : '') : 'non'}</div>
          <div><span class="dot ${d.envoi ? '' : 'off'}"></span>Envoi par colis : ${d.envoi ? 'oui' : 'non'}</div>
        </div></section>
      </div>
    </article>`;
  }

  // Défilement de la galerie : compteur et vignettes. Réutilisé dans l'aperçu téléchargé.
  function galleryScript(root) {
    const track = root.querySelector('[data-track]');
    if (!track) return;
    const count = root.querySelector('[data-count]');
    const thumbs = Array.from(root.querySelectorAll('[data-thumb]'));
    const n = track.children.length;
    track.addEventListener('scroll', () => {
      const i = Math.round(track.scrollLeft / track.clientWidth);
      if (count) count.textContent = (i + 1) + '/' + n;
      thumbs.forEach((t, j) => t.classList.toggle('on', j === i));
    }, { passive: true });
    thumbs.forEach((t) => t.addEventListener('click', () => {
      track.scrollTo({ left: Number(t.dataset.thumb) * track.clientWidth, behavior: 'smooth' });
    }));
  }

  function viewAnnonce() {
    const ad = state.ad;
    const tl = ad.titre.length;
    const dl = ad.description.length;
    return `
      <h1>Votre annonce est prête</h1>
      <p class="lead">Relisez, ajustez si besoin, puis copiez le texte dans Leboncoin ou téléchargez le tout.</p>
      ${errorBox()}
      <div class="tabs" role="tablist">
        <button role="tab" id="tab-apercu" aria-selected="${state.tab === 'apercu'}">Aperçu</button>
        <button role="tab" id="tab-texte" aria-selected="${state.tab === 'texte'}">Modifier et copier</button>
      </div>
      <div id="panel-apercu" ${state.tab === 'apercu' ? '' : 'hidden'}>${adPreviewHtml(state.photos.map((p) => p.url))}</div>
      <div id="panel-texte" ${state.tab === 'texte' ? '' : 'hidden'}>
        <div class="card">
          <div class="copy-row"><label class="label" for="ad-title">Titre</label><button class="btn ghost small" data-copy="titre">Copier</button></div>
          <input class="input" id="ad-title" value="${esc(ad.titre)}" maxlength="${TITLE_MAX}">
          <div class="counter ${tl > TITLE_MAX ? 'over' : ''}" id="title-count">${tl}/${TITLE_MAX}</div>
        </div>
        <div class="card">
          <div class="copy-row"><label class="label" for="ad-price">Prix</label><button class="btn ghost small" data-copy="prix">Copier</button></div>
          <div class="price-wrap"><input class="input price-input" id="ad-price" inputmode="decimal" value="${esc(state.details.prix)}"></div>
        </div>
        <div class="card">
          <div class="copy-row"><label class="label" for="ad-desc">Description</label><button class="btn ghost small" data-copy="description">Copier</button></div>
          <textarea class="textarea" id="ad-desc" rows="16">${esc(ad.description)}</textarea>
          <div class="counter ${dl > DESC_MAX ? 'over' : ''}" id="desc-count">${dl}/${DESC_MAX}</div>
        </div>
      </div>
      <div style="margin-top:14px">${enhanceCard()}</div>
      <div class="card">
        <h2>Récupérer l'annonce</h2>
        <div class="export-grid">
          <button class="btn" id="btn-download">Tout télécharger (.zip)</button>
          ${navigator.share ? '<button class="btn secondary" id="btn-share">Partager photos et texte</button>' : ''}
          <button class="btn secondary" id="btn-copy-all">Copier titre et description</button>
          <a class="btn secondary" href="https://www.leboncoin.fr/deposer-une-annonce" target="_blank" rel="noopener">Ouvrir Leboncoin</a>
        </div>
        <p class="muted small" style="margin:10px 0 0">Le fichier contient les photos renommées et nettoyées de leur position GPS, le texte et un aperçu consultable hors ligne.</p>
      </div>
      ${actionbar(`<button class="btn secondary" id="btn-back">Retour</button><button class="btn secondary" id="btn-regen" style="flex:1">Réécrire</button><button class="btn" id="btn-new">Nouvelle</button>`)}`;
  }

  // ---------- Événements ----------
  const bind = {
    key() {
      const input = $('#key-input');
      $('#key-toggle').onclick = () => {
        input.type = input.type === 'password' ? 'text' : 'password';
        $('#key-toggle').textContent = input.type === 'password' ? 'Voir' : 'Cacher';
      };
      $('#key-form').onsubmit = async (ev) => {
        ev.preventDefault();
        const key = input.value.trim();
        if (!key) return;
        const btn = $('#key-submit');
        btn.disabled = true; btn.textContent = 'Vérification...';
        try {
          await checkKey(key);
          if (!store.set(STORAGE_KEY, key)) throw new Error("Ce navigateur bloque l'enregistrement local (navigation privée ?).");
          state.error = '';
          state.step = 'photos';
          render();
          toast('Clé enregistrée');
        } catch (e) {
          state.error = e instanceof TypeError ? 'Connexion à OpenRouter impossible. Vérifiez votre réseau.' : e.message;
          render();
          $('#key-input').value = key;
        }
      };
    },

    photos() {
      const fileInput = $('#file-input');
      const cameraInput = $('#camera-input');
      const onFiles = (e) => { addFiles(e.target.files); e.target.value = ''; };
      fileInput.onchange = onFiles;
      cameraInput.onchange = onFiles;
      $('#btn-gallery').onclick = (e) => { e.preventDefault(); fileInput.click(); };
      $('#btn-camera').onclick = (e) => { e.preventDefault(); cameraInput.click(); };
      const dz = $('#dropzone');
      dz.onclick = (e) => { if (e.target === dz || e.target.closest('svg,strong,.muted')) { e.preventDefault(); fileInput.click(); } };
      dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('drag'); };
      dz.ondragleave = () => dz.classList.remove('drag');
      dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('drag'); addFiles(e.dataTransfer.files); };
      $$('[data-remove]').forEach((b) => {
        b.onclick = (e) => {
          e.stopPropagation();
          const p = state.photos.find((x) => x.id === b.dataset.remove);
          if (p) URL.revokeObjectURL(p.url);
          state.photos = state.photos.filter((x) => x.id !== b.dataset.remove);
          render();
        };
      });
      $$('.photo').forEach((el) => {
        const cover = () => {
          const i = state.photos.findIndex((x) => x.id === el.dataset.id);
          if (i > 0) { state.photos.unshift(...state.photos.splice(i, 1)); render(); toast('Photo de couverture changée'); }
        };
        el.onclick = cover;
        el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cover(); } };
      });
      $('#hint').oninput = (e) => { state.hint = e.target.value; };
      $('#btn-analyze').onclick = () => runAnalysis();
    },

    analyzing() { animateSteps(); },
    generating() { animateSteps(); },

    questions() {
      $$('[data-fact]').forEach((i) => { i.oninput = () => { state.facts[i.dataset.fact] = i.value; }; });
      $$('input[type=radio]', app).forEach((r) => {
        r.onchange = () => {
          state.answers[r.name] = r.value;
          const other = $(`[data-answer="${r.name}"][data-other]`);
          if (other) other.value = '';
        };
      });
      $$('[data-answer]').forEach((i) => {
        i.oninput = () => {
          state.answers[i.dataset.answer] = i.value;
          if (i.dataset.other) $$(`input[name="${i.dataset.answer}"]`).forEach((r) => { r.checked = false; });
        };
      });
      $('#btn-back').onclick = () => { state.error = ''; state.step = 'photos'; render(); };
      $('#btn-next').onclick = () => { state.error = ''; state.step = 'details'; render(); window.scrollTo(0, 0); };
    },

    details() {
      const d = state.details;
      const refreshButton = () => {
        $('#btn-write').disabled = !(d.etat && (d.mainPropre || d.envoi));
      };
      $$('input[name=etat]').forEach((r) => { r.onchange = () => { d.etat = r.value; refreshButton(); }; });
      $('#prix').oninput = (e) => { d.prix = e.target.value.replace(/[^\d.,]/g, ''); e.target.value = d.prix; };
      $$('[data-price]').forEach((b) => { b.onclick = () => { d.prix = b.dataset.price; $('#prix').value = d.prix; }; });
      $('#mainPropre').onchange = (e) => { d.mainPropre = e.target.checked; render(); };
      $('#envoi').onchange = (e) => { d.envoi = e.target.checked; render(); };
      $('#ville').oninput = (e) => { d.ville = e.target.value; };
      $('#notes').oninput = (e) => { d.notes = e.target.value; };
      $('#btn-back').onclick = () => { state.error = ''; state.step = 'questions'; render(); };
      $('#btn-write').onclick = () => runWriting();
    },

    annonce() {
      galleryScript($('#panel-apercu'));
      const setTab = (t) => { state.tab = t; render(); };
      $('#tab-apercu').onclick = () => setTab('apercu');
      $('#tab-texte').onclick = () => setTab('texte');
      $('#ad-title').oninput = (e) => {
        state.ad.titre = e.target.value;
        const c = $('#title-count'); c.textContent = `${e.target.value.length}/${TITLE_MAX}`; c.classList.toggle('over', e.target.value.length > TITLE_MAX);
      };
      $('#ad-desc').oninput = (e) => {
        state.ad.description = e.target.value;
        const c = $('#desc-count'); c.textContent = `${e.target.value.length}/${DESC_MAX}`; c.classList.toggle('over', e.target.value.length > DESC_MAX);
      };
      $('#ad-price').oninput = (e) => { state.details.prix = e.target.value.replace(/[^\d.,]/g, ''); e.target.value = state.details.prix; };
      $$('[data-copy]').forEach((b) => {
        b.onclick = () => {
          const k = b.dataset.copy;
          copy(k === 'prix' ? String(state.details.prix) : state.ad[k]);
        };
      });
      $('#btn-copy-all').onclick = () => copy(`${state.ad.titre}\n\n${state.ad.description}`);
      $('#btn-download').onclick = (e) => downloadAll(e.currentTarget);
      if ($('#btn-share')) $('#btn-share').onclick = (e) => shareAll(e.currentTarget);
      $('#btn-back').onclick = () => { state.error = ''; state.step = 'details'; render(); };
      $('#btn-regen').onclick = () => runWriting();
      $('#btn-new').onclick = () => openConfirmNew();
      const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
      on('#btn-enhance-retry', () => runEnhance());
      on('#btn-enhance-drop', () => { state.enhance = { busy: false, url: '', error: '' }; render(); });
      on('#btn-enhance-use', () => {
        state.photos = state.photos.filter((p) => !p.generated);
        state.photos.unshift({ id: uid(), url: state.enhance.url, apiData: '', generated: true });
        state.enhance = { busy: false, url: '', error: '' };
        state.tab = 'apercu';
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        toast('Photo mise en couverture');
      });
      on('#btn-enhance-remove', () => { state.photos = state.photos.filter((p) => !p.generated); render(); });
    },
  };

  let stepTimer;
  function animateSteps() {
    clearInterval(stepTimer);
    let i = 0;
    stepTimer = setInterval(() => {
      const items = $$('#loading-steps li');
      if (!items.length) { clearInterval(stepTimer); return; }
      if (i < items.length - 1) {
        items[i].className = 'ok';
        i += 1;
        items[i].className = 'on';
      }
    }, 3500);
  }

  // ---------- Panneau du bas ----------
  function openSheet(html, onBind) {
    const sheet = $('#sheet');
    sheet.innerHTML = html;
    sheet.hidden = false;
    $('#sheet-backdrop').hidden = false;
    $('#sheet-backdrop').onclick = closeSheet;
    onBind && onBind(sheet);
  }
  function closeSheet() {
    $('#sheet').hidden = true;
    $('#sheet-backdrop').hidden = true;
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

  function modelField(role) {
    const r = ROLES[role];
    const current = model(role);
    const custom = !r.models.some((m) => m.id === current);
    return `<div class="field" data-role="${role}">
      <label class="label" for="model-${role}">${r.label}</label>
      <select class="select input" id="model-${role}">
        ${r.models.map((m) => `<option value="${m.id}" ${m.id === current ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}
        <option value="__custom" ${custom ? 'selected' : ''}>Autre modèle OpenRouter...</option>
      </select>
      <input class="input" style="margin-top:8px" id="custom-${role}" ${custom ? '' : 'hidden'} value="${custom ? esc(current) : ''}"
        placeholder="fournisseur/modele" autocapitalize="off" spellcheck="false" aria-label="Identifiant du modèle">
      <span class="hint">${r.hint}</span>
    </div>`;
  }

  function openSettings() {
    const key = apiKey();
    const masked = key ? key.slice(0, 10) + '•••••' + key.slice(-4) : '';
    openSheet(`
      <h2 id="sheet-title">Réglages</h2>
      <div class="field"><span class="label">Clé OpenRouter</span>
        <div class="input" style="display:flex;align-items:center;background:var(--bg)">
          <code style="font-size:14px;overflow:hidden;text-overflow:ellipsis">${esc(masked)}</code>
        </div>
        <span class="hint">Enregistrée dans ce navigateur, sans expiration.</span>
      </div>
      <button class="btn danger block" id="btn-forget" style="margin-bottom:20px">Changer de clé</button>
      ${Object.keys(ROLES).map(modelField).join('')}
      <button class="btn secondary block" id="btn-reset-models" style="margin-bottom:10px">Modèles par défaut</button>
      <button class="btn block" id="btn-close-settings">Fermer</button>`, (s) => {
      Object.keys(ROLES).forEach((role) => {
        const sel = $(`#model-${role}`, s);
        const input = $(`#custom-${role}`, s);
        sel.onchange = () => {
          input.hidden = sel.value !== '__custom';
          if (sel.value !== '__custom') { store.set(ROLES[role].storage, sel.value); toast('Modèle enregistré'); } else input.focus();
        };
        input.onchange = () => { if (input.value.trim()) { store.set(ROLES[role].storage, input.value.trim()); toast('Modèle enregistré'); } };
      });
      $('#btn-reset-models', s).onclick = () => {
        Object.values(ROLES).forEach((r) => store.del(r.storage));
        closeSheet(); toast('Modèles par défaut rétablis');
      };
      $('#btn-forget', s).onclick = () => {
        store.del(STORAGE_KEY);
        closeSheet();
        state.error = '';
        render();
      };
      $('#btn-close-settings', s).onclick = closeSheet;
    });
  }
  $('#btn-settings').onclick = openSettings;

  function openConfirmNew() {
    openSheet(`
      <h2 id="sheet-title">Commencer une nouvelle annonce ?</h2>
      <p class="muted">Les photos et le texte de l'annonce actuelle seront effacés. Pensez à la télécharger avant.</p>
      <div style="display:grid;gap:10px">
        <button class="btn" id="confirm-new">Nouvelle annonce</button>
        <button class="btn secondary" id="cancel-new">Annuler</button>
      </div>`, (s) => {
      $('#confirm-new', s).onclick = () => {
        state.photos.forEach((p) => { if (!p.generated) URL.revokeObjectURL(p.url); });
        Object.assign(state, freshState());
        closeSheet();
        render();
        window.scrollTo(0, 0);
      };
      $('#cancel-new', s).onclick = closeSheet;
    });
  }

  // Évite de perdre le travail par un retour arrière accidentel.
  window.addEventListener('beforeunload', (e) => {
    if (state.photos.length) { e.preventDefault(); e.returnValue = ''; }
  });

  render();
})();
