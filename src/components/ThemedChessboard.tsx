import { type ComponentProps } from 'react';
import { Chessboard } from 'react-chessboard';
import { useTheme } from './ThemeContext';
import { getBoardTheme } from './board-themes';

type ChessboardProps = ComponentProps<typeof Chessboard>;
type ThemedChessboardProps = Omit<
  ChessboardProps,
  'customDarkSquareStyle' | 'customLightSquareStyle'
>;

export default function ThemedChessboard(props: ThemedChessboardProps) {
  const { boardTheme } = useTheme();
  const theme = getBoardTheme(boardTheme);

  return (
    <Chessboard
      {...props}
      customDarkSquareStyle={{ backgroundColor: theme.darkSquare }}
      customLightSquareStyle={{ backgroundColor: theme.lightSquare }}
      customBoardStyle={{
        borderRadius: '4px',
        ...props.customBoardStyle,
      }}
    />
  );
}
