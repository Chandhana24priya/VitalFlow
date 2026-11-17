import { useEffect, useState } from "react";
import { Plus, Trash2, CheckCircle2, Circle, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { applyStreak } from "@/lib/streak";
import { seedDefaultsOnce, MODULE_DEFAULTS } from "@/lib/defaults";
import { AIAssistant } from "@/components/AIAssistant";

interface Task {
  id: string;
  title: string;
  completed: boolean;
  category: string;
  task_date: string;
}

const today = () => new Date().toISOString().slice(0, 10);

interface Props {
  /** category key, must exist in MODULE_DEFAULTS (e.g. "skin", "hair", "habit") */
  moduleKey: keyof typeof MODULE_DEFAULTS;
  /** AI module bucket: "habit" | "nutrition" */
  aiModule: "habit" | "nutrition";
  title: string;
  aiTitle: string;
  starterQuestions: string[];
}

export function ModuleChecklist({ moduleKey, aiModule, title, aiTitle, starterQuestions }: Props) {
  const { user, refreshProfile } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [showAI, setShowAI] = useState(false);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("daily_tasks")
      .select("*")
      .eq("user_id", user.id)
      .eq("category", moduleKey)
      .eq("task_date", today())
      .order("created_at");
    setTasks((data as Task[]) ?? []);
  };

  useEffect(() => {
    if (!user) return;
    (async () => {
      await seedDefaultsOnce(user.id, moduleKey);
      await load();
    })();
    // eslint-disable-next-line
  }, [user, moduleKey]);

  // Realtime sync with dashboard / other modules
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`tasks-${moduleKey}-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "daily_tasks", filter: `user_id=eq.${user.id}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line
  }, [user, moduleKey]);

  // Refetch on tab focus / visibility — guarantees fresh DB state on return.
  useEffect(() => {
    if (!user) return;
    const onFocus = () => load();
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line
  }, [user, moduleKey]);

  const toggle = async (t: Task) => {
    const newCompleted = !t.completed;
    // Optimistic
    setTasks((p) => p.map((x) => (x.id === t.id ? { ...x, completed: newCompleted } : x)));
    const { error } = await supabase.from("daily_tasks").update({ completed: newCompleted }).eq("id", t.id);
    if (error) {
      setTasks((p) => p.map((x) => (x.id === t.id ? { ...x, completed: t.completed } : x)));
      toast.error("Couldn't save — try again");
      return;
    }
    if (user) {
      // Re-load from DB before recomputing streak (single source of truth).
      await load();
      const res = await applyStreak(user.id);
      console.log("[streak] module result", { moduleKey, ...res });
      await refreshProfile();
    }
  };

  const add = async () => {
    if (!newTitle.trim() || !user) return;
    const { data } = await supabase
      .from("daily_tasks")
      .insert({ user_id: user.id, title: newTitle.trim(), category: moduleKey, task_date: today() })
      .select()
      .single();
    if (data) setTasks((p) => [...p, data as Task]);
    setNewTitle("");
  };

  const remove = async (id: string) => {
    await supabase.from("daily_tasks").delete().eq("id", id);
    setTasks((p) => p.filter((t) => t.id !== id));
    toast.success("Task removed");
  };

  const completed = tasks.filter((t) => t.completed).length;
  const percent = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 rounded-2xl bg-card border border-border p-5 shadow-soft">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold">{title}</h3>
            <p className="text-xs text-muted-foreground">
              {completed}/{tasks.length} done · {percent}%
            </p>
          </div>
          <Button
            size="sm"
            variant={showAI ? "secondary" : "outline"}
            onClick={() => setShowAI((s) => !s)}
          >
            <Sparkles className="h-4 w-4 mr-1" />
            {showAI ? "Hide AI" : "Ask AI"}
          </Button>
        </div>

        <div className="flex gap-2 mb-4">
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Add a task…"
          />
          <Button onClick={add} size="icon">
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No tasks yet. Add one above or ask AI for suggestions.
          </p>
        ) : (
          <ul className="space-y-2">
            {tasks.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-3 rounded-lg bg-muted/40 p-3 group"
              >
                <button onClick={() => toggle(t)} className="shrink-0">
                  {t.completed ? (
                    <CheckCircle2 className="h-5 w-5 text-primary" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground" />
                  )}
                </button>
                <span className={`flex-1 text-sm ${t.completed ? "line-through text-muted-foreground" : ""}`}>
                  {t.title}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 opacity-0 group-hover:opacity-100"
                  onClick={() => remove(t.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl bg-card border border-border p-5 shadow-soft">
        {showAI ? (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">AI Coach</h3>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setShowAI(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <AIAssistant module={aiModule} title={aiTitle} starterQuestions={starterQuestions} />
          </div>
        ) : (
          <div className="text-center py-8">
            <Sparkles className="h-8 w-8 text-primary mx-auto mb-2" />
            <h3 className="font-semibold text-sm mb-1">Need ideas?</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Tap "Ask AI" to get personalized suggestions. Add them to your checklist with one click.
            </p>
            <Button size="sm" variant="outline" onClick={() => setShowAI(true)}>
              <Sparkles className="h-4 w-4 mr-1" />
              Open AI Coach
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
