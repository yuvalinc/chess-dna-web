import { type ComponentProps } from 'react';
import { Chessboard } from 'react-chessboard';
import { useTheme } from './ThemeContext';
import { getBoardTheme } from './board-themes';
import { cburnettShadowPieces } from './cburnett-shadow-pieces';

type ChessboardProps = ComponentProps<typeof Chessboard>;
type ThemedChessboardProps = Omit<
  ChessboardProps,
  'customDarkSquareStyle' | 'customLightSquareStyle'
> & {
  /** Optional theme id override — used by the Hybrid Salvage replay flow to
   *  force the classic wood look (cream/brown) regardless of the user's
   *  global board-theme setting. */
  forceThemeId?: string;
};

export default function ThemedChessboard({ forceThemeId, ...props }: ThemedChessboardProps) {
  const { boardTheme } = useTheme();
  const theme = getBoardTheme(forceThemeId ?? boardTheme);

  return (
    <div dir="ltr" style={{ direction: 'ltr' }}>
      <Chessboard
        {...props}
        customPieces={props.customPieces ?? cburnettShadowPieces}
        customDarkSquareStyle={{ backgroundColor: theme.darkSquare }}
        customLightSquareStyle={{ backgroundColor: theme.lightSquare }}
        customBoardStyle={{
          borderRadius: '4px',
          ...props.customBoardStyle,
        }}
      />
    </div>
  );
}
