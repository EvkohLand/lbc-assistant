# Assistant annonce Leboncoin

Application web, pensée pour le téléphone, qui rédige une annonce Leboncoin à partir de photos.

**En ligne : https://evkohland.github.io/lbc-assistant/**

## Ce qu'elle fait

1. **Clé OpenRouter** demandée à la première visite, puis gardée dans le navigateur (`localStorage`, sans expiration). Elle n'est envoyée qu'à OpenRouter.
2. **Photos** : jusqu'à 10, depuis l'appareil photo ou la galerie. Touchez une photo pour la mettre en couverture.
3. **Analyse** : l'IA lit les photos (objet, marque, référence, dimensions, défauts visibles, prix d'occasion constaté) et pose 3 à 5 questions sur ce que les photos ne montrent pas.
4. **Détails** : état (neuf, très bon, bon, satisfaisant, pour pièces), prix, remise en main propre, envoi possible. L'état change le ton de la description.
5. **Annonce** : titre optimisé pour la recherche Leboncoin, description, points forts, mode d'emploi de l'objet, aperçu fidèle, édition et copie en un geste.
6. **Photo mise en valeur** (facultatif) : l'objet détouré sur fond clair avec un éclairage de studio.
7. **Téléchargement** : un `.zip` avec le texte, les photos renommées (position GPS retirée) et un aperçu consultable hors ligne. Sur mobile, bouton de partage natif.

Les textes générés passent par un filtre qui retire les marques typiques d'une IA : tirets cadratins, émojis, markdown, guillemets typographiques, formules toutes faites.

## Modèles utilisés (modifiables dans les réglages)

| Rôle | Modèle par défaut |
|---|---|
| Analyse des photos | `google/gemini-3.8-flash` |
| Rédaction | `deepseek/deepseek-v4.1-flash` |
| Photo mise en valeur | `openai/gpt-image-2.5-sunburst` |

## Développement

Aucune étape de build : HTML, CSS et JavaScript servis tels quels.

```sh
python3 -m http.server 8000   # puis http://localhost:8000
node --test tests/*.test.js   # tests du filtre anti-marques d'IA
```

Chaque push sur `main` lance les tests puis déploie sur GitHub Pages (`.github/workflows/pages.yml`).
