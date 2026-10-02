import { GameScreen } from "@/ui/GameScreen";

export default async function PlayPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  return <GameScreen gameId={gameId} />;
}
