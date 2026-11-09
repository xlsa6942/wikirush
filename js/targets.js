// Cibles connues, rangées par catégorie. Aucun pays ni année ici : ce serait
// impossible à atteindre avec la règle "pages interdites".
// Si un titre n'existe plus sur Wikipédia ou mène à une page d'homonymie,
// il est simplement ignoré au moment du tirage.

export const TARGETS = {
  Musique: [
    'Beyoncé', 'Michael Jackson', 'Rihanna', 'Taylor Swift', 'The Beatles', 'Daft Punk', 'Stromae',
    'Édith Piaf', 'Johnny Hallyday', 'Aya Nakamura', 'Queen (groupe)', 'Elvis Presley',
    'Wolfgang Amadeus Mozart', 'Ludwig van Beethoven', 'Lady Gaga', 'Céline Dion', 'Eminem',
    'Billie Eilish', 'Bob Marley', 'Jazz', 'Rap', 'Guitare', 'Piano', 'Eurovision',
  ],
  'Cinéma et séries': [
    'Star Wars', 'Harry Potter', 'Le Seigneur des anneaux', 'Friends', 'Game of Thrones', 'Les Simpson',
    'Stranger Things', 'Walt Disney', 'Steven Spielberg', 'Leonardo DiCaprio', 'Marilyn Monroe',
    'Charlie Chaplin', 'James Bond', 'Pixar Animation Studios', 'Netflix', 'Shrek', 'Batman',
    'Spider-Man', 'Mickey Mouse', 'Titanic (film, 1997)', 'Festival de Cannes', 'Oscars du cinéma',
  ],
  Sport: [
    'Football', 'Zinédine Zidane', 'Kylian Mbappé', 'Lionel Messi', 'Cristiano Ronaldo', 'Serena Williams',
    'Usain Bolt', 'Jeux olympiques', 'Tour de France', 'Coupe du monde de football', 'Michael Jordan',
    'Roger Federer', 'Rafael Nadal', 'Tennis', 'Basket-ball', 'Formule 1', 'Rugby à XV', 'Skateboard',
  ],
  Histoire: [
    'Napoléon Ier', "Jeanne d'Arc", 'Révolution française', 'Seconde Guerre mondiale',
    'Première Guerre mondiale', 'Cléopâtre VII', 'Jules César', 'Louis XIV', 'Marie-Antoinette',
    'Charles de Gaulle', 'Égypte antique', 'Vikings', 'Moyen Âge', 'Mur de Berlin',
    'Martin Luther King', 'Nelson Mandela', 'Titanic (paquebot)', 'Rome antique', 'Chevalier',
  ],
  Sciences: [
    'Albert Einstein', 'Marie Curie', 'Isaac Newton', 'Charles Darwin', 'Lune', 'Soleil',
    'Mars (planète)', 'Trou noir', 'Acide désoxyribonucléique', 'Dinosauria', 'Internet',
    'Intelligence artificielle', 'Volcan', 'Électricité', 'Big Bang', 'Apollo 11', 'Galilée (savant)',
    'Système solaire', 'Station spatiale internationale', 'Arc-en-ciel',
  ],
  Lieux: [
    'Tour Eiffel', 'Paris', 'New York', 'Tokyo', 'Lyon', 'Marseille', 'Statue de la Liberté', 'Colisée',
    'Grande Muraille', 'Everest', 'Venise', 'Machu Picchu', 'Taj Mahal', 'Disneyland Paris',
    'Musée du Louvre', 'Sahara', 'Antarctique', 'Océan Pacifique', 'Mont Saint-Michel', 'Hollywood',
  ],
  Cuisine: [
    'Pizza', 'Croissant', 'Chocolat', 'Sushi', 'Hamburger', 'Fromage', 'Crêpe', 'Café', 'Coca-Cola',
    'Nutella', 'Raclette', 'Macaron', 'Frite', 'Tomate', 'Fraise', 'Banane', 'Ramen', 'Glace (dessert)',
  ],
  Animaux: [
    'Chat', 'Chien', 'Lion', 'Panda géant', 'Grand requin blanc', 'Dauphin', 'Éléphant', 'Girafe',
    'Pieuvre', 'Manchot empereur', 'Koala', 'Loup gris', 'Tyrannosaurus', 'Abeille', 'Licorne',
    'Paresseux', 'Axolotl',
  ],
  'Art et culture': [
    'Léonard de Vinci', 'La Joconde', 'Vincent van Gogh', 'Pablo Picasso', 'Victor Hugo', 'Molière',
    'William Shakespeare', 'Les Misérables', 'Le Petit Prince', 'Les Aventures de Tintin', 'Astérix',
    'One Piece', 'Naruto', 'Dragon Ball', 'Barbie', 'Lego', 'Frida Kahlo', 'Banksy',
  ],
  'Jeux et web': [
    'Pokémon', 'Minecraft', 'Fortnite', 'Tetris', 'The Legend of Zelda', 'Nintendo', 'PlayStation',
    'Super Mario Bros.', 'Pac-Man', 'Instagram', 'TikTok', 'YouTube', 'Wikipédia', 'Apple', 'iPhone',
    'Google', 'Emoji', 'Mème Internet',
  ],
};

// Tire des candidates dans des catégories différentes, en évitant les cibles déjà jouées.
export function pickCandidates(count, used = new Set()) {
  const cats = Object.keys(TARGETS).sort(() => Math.random() - 0.5);
  const out = [];
  let round = 0;
  while (out.length < count && round < 4) {
    for (const c of cats) {
      if (out.length >= count) break;
      const pool = TARGETS[c].filter((t) => !used.has(t) && !out.some((o) => o.title === t));
      if (!pool.length) continue;
      out.push({ title: pool[Math.floor(Math.random() * pool.length)], category: c });
    }
    round++;
  }
  return out;
}
