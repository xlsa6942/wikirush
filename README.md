# WikiRush ⚡

La course de clics sur Wikipédia, entre potes.

Une page Wikipédia au hasard, une cible connue, et la première qui l'atteint en cliquant de lien en lien gagne. Chacune joue sur son propre appareil (téléphone ou ordi).

## Comment jouer

1. Une personne ouvre le site, choisit un pseudo et clique sur **Créer une partie**. Un code apparaît (ex : `BANANE42`).
2. Les autres entrent ce code sur l'accueil, ou ouvrent directement le lien d'invitation (bouton copier à côté du code).
3. L'hôte règle la partie puis clique sur **Démarrer**.
4. Trois cibles connues sont proposées : chacune vote. La plus votée gagne (égalité : tirage au sort). Le vote dure 30 secondes, l'hôte peut lancer avant.
5. Décompte 3, 2, 1… et c'est parti : on navigue dans Wikipédia directement sur le site.
6. Celle qui atterrit sur la page cible déclenche les confettis 🎉 et attend les autres. Dès qu'une joueuse a trouvé, les autres voient un bandeau avec un bouton **Abandonner** si elles préfèrent passer aux résultats.
7. Résultats : podium et chemin de chacune, page par page. Puis revanche !

## Règles et options

| Réglage | Choix |
| --- | --- |
| Page de départ | La même pour toutes, ou chacune la sienne |
| Classement | Au temps, ou au moins de clics |
| Limite de temps | 5 min, 10 min, illimité |
| Bouton retour | Autorisé ou non (un retour compte comme un clic) |
| Rechercher dans la page | Ctrl+F autorisé ou bloqué |
| Pages interdites | Pays et années bloqués (ce sont des raccourcis vers presque tout) |
| Sommaire | Les sections de la page sur le côté (ou via le bouton liste sur téléphone) pour y sauter direct, sans compter de clic |

Les sons sont toujours activés. Les stats et l'historique des parties sont gardés sur chaque appareil.

## Bon à savoir

- **Le jeu n'a pas de serveur** : les appareils se parlent directement (WebRTC via [PeerJS](https://peerjs.com/)). L'hôte garde la partie, donc si elle ferme son onglet, la partie s'arrête pour tout le monde.
- Si la connexion ne passe pas entre deux appareils (certains réseaux 4G ou d'entreprise bloquent ce type de connexion), essayez d'être toutes sur le même wifi.
- Sur téléphone, la recherche dans la page du navigateur (menu ⋮ > Rechercher) ne peut pas être bloquée : on compte sur votre honnêteté 😇
- Le contenu vient de [Wikipédia en français](https://fr.wikipedia.org), sous licence [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.fr).

## Lancer le site chez soi

C'est un site statique, sans étape de compilation :

```bash
python3 -m http.server 8080
# puis ouvrir http://localhost:8080
```

## Fichiers

- `index.html`, `css/style.css` : la page et son style
- `js/main.js` : la logique du jeu et les écrans
- `js/net.js` : la connexion entre appareils
- `js/wiki.js` : le chargement des articles Wikipédia
- `js/targets.js` : la liste des cibles connues (à enrichir librement !)
- `js/forbidden.js` : les pages interdites
- `js/sound.js`, `js/stats.js` : sons et historique
- `js/vendor/` : PeerJS et canvas-confetti (licence MIT)
