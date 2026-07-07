import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function ComingSoonPage({
  title,
  phase,
  description,
}: {
  title: string;
  phase: string;
  description?: string;
}) {
  return (
    <div className="mx-auto max-w-xl py-12">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>{title}</CardTitle>
            <Badge variant="secondary">{phase}</Badge>
          </div>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {description ??
            "This area is planned but not built yet. It arrives in a later phase."}
        </CardContent>
      </Card>
    </div>
  );
}
