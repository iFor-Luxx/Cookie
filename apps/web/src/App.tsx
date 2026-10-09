import { Brush, History, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function App(): React.JSX.Element {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
        <p className="font-pixel text-sm tracking-widest text-muted-foreground uppercase">
          Cookie · H1 fundaciones
        </p>
        <h1 className="font-serif text-5xl leading-tight">
          Dibujo compartido para dos.
        </h1>
        <p className="text-muted-foreground">
          Monorepo Bun + React + Tailwind v4 + shadcn listo. El lienzo (H3)
          consumirá <code className="font-mono text-sm">@cookie/core</code> y{" "}
          <code className="font-mono text-sm">@cookie/drawing</code>.
        </p>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brush className="size-5" aria-hidden /> Estado del init
            </CardTitle>
            <CardDescription>
              UI única en apps/web, reutilizada por Capacitor en Android.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Badge>Tailwind v4 oklch</Badge>
            <Badge variant="secondary">Instrument Serif</Badge>
            <Badge variant="secondary">Geist Pixel Square</Badge>
            <Badge variant="outline">lucide-react</Badge>
          </CardContent>
        </Card>
        <div className="flex flex-wrap gap-3">
          <Button>
            <Sparkles className="size-4" aria-hidden /> Empezar H2 pairing
          </Button>
          <Button variant="secondary">
            <History className="size-4" aria-hidden /> Ver historial (H4)
          </Button>
        </div>
      </div>
    </main>
  );
}
