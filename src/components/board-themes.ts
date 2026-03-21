export interface BoardTheme {
  id: string;
  name: string;
  lightSquare: string;
  darkSquare: string;
}

export const BOARD_THEMES: BoardTheme[] = [
  { id: 'classic', name: 'Classic', lightSquare: '#f0d9b5', darkSquare: '#b58863' },
  { id: 'green', name: 'Green', lightSquare: '#eeeed2', darkSquare: '#769656' },
  { id: 'blue', name: 'Blue', lightSquare: '#dee3e6', darkSquare: '#8ca2ad' },
  { id: 'brown', name: 'Brown', lightSquare: '#f0d9b5', darkSquare: '#946f51' },
  { id: 'purple', name: 'Purple', lightSquare: '#e8e0f0', darkSquare: '#7b61a5' },
  { id: 'icy', name: 'Icy', lightSquare: '#e0e8ef', darkSquare: '#7fa0b5' },
  { id: 'walnut', name: 'Walnut', lightSquare: '#d6c4a0', darkSquare: '#8b6b3d' },
  { id: 'emerald', name: 'Emerald', lightSquare: '#adbd8f', darkSquare: '#6e8252' },
];

export function getBoardTheme(id: string): BoardTheme {
  return BOARD_THEMES.find((t) => t.id === id) ?? BOARD_THEMES[0];
}
