import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TaskCard } from "@/components/pm/TaskCard";
import { TaskFormDialog } from "@/components/pm/TaskFormDialog";
import {
  AssigneeAvatars,
  PriorityBadge,
  StatusBadge,
} from "@/components/pm/TaskMeta";
import { STATUSES, formatDate, isOverdue } from "@/lib/pm";
import { cn } from "@/lib/utils";

export function BoardPage() {
  const { boardId } = useParams<{ boardId: string }>();
  const id = boardId as Id<"boards">;
  const boards = useQuery(api.boards.list, {});
  const tasks = useQuery(api.tasks.listByBoard, { boardId: id });
  const updateTask = useMutation(api.tasks.update);

  const board = boards?.find((b) => b._id === id);

  function moveTask(taskId: Id<"tasks">, status: Doc<"tasks">["status"]) {
    void updateTask({ id: taskId, status });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <Link
            to="/boards"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Boards
          </Link>
          <div className="flex items-center gap-2">
            <h1 className="brand-title text-3xl">
              {board?.name ?? "Board"}
            </h1>
            {board && (
              <Badge variant="secondary" className="capitalize">
                {board.subsystem}
              </Badge>
            )}
          </div>
        </div>
        <TaskFormDialog
          defaultBoardId={id}
          trigger={<Button>New task</Button>}
        />
      </div>

      <Tabs defaultValue="kanban">
        <TabsList>
          <TabsTrigger value="kanban">Kanban</TabsTrigger>
          <TabsTrigger value="list">List</TabsTrigger>
        </TabsList>

        <TabsContent value="kanban">
          {tasks === undefined ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STATUSES.map((col) => {
                const colTasks = tasks.filter((t) => t.status === col.value);
                return (
                  <div
                    key={col.value}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const dropped = e.dataTransfer.getData("text/plain");
                      if (dropped) {
                        moveTask(dropped as Id<"tasks">, col.value);
                      }
                    }}
                    className={cn(
                      "flex min-h-[120px] flex-col gap-2 rounded-lg border-t-4 bg-muted/30 p-2",
                      col.columnClass,
                    )}
                  >
                    <div className="flex items-center justify-between px-1 py-1">
                      <span className="text-sm font-medium">{col.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {colTasks.length}
                      </span>
                    </div>
                    {colTasks.map((task) => (
                      <div
                        key={task._id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", task._id);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                      >
                        <TaskCard task={task} />
                      </div>
                    ))}
                    {colTasks.length === 0 && (
                      <p className="px-1 py-4 text-center text-xs text-muted-foreground">
                        Drop tasks here
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="list">
          {tasks === undefined ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tasks on this board yet.</p>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Assignees</TableHead>
                    <TableHead>Due</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map((task) => (
                    <TableRow key={task._id}>
                      <TableCell>
                        <Link
                          to={`/tasks/${task._id}`}
                          className="font-medium hover:underline"
                        >
                          {task.title}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={task.status} />
                      </TableCell>
                      <TableCell>
                        <PriorityBadge priority={task.priority} />
                      </TableCell>
                      <TableCell>
                        <AssigneeAvatars assigneeIds={task.assigneeIds} />
                      </TableCell>
                      <TableCell
                        className={cn(
                          isOverdue(task) && "font-medium text-danger",
                        )}
                      >
                        {formatDate(task.dueDate)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
