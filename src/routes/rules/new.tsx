import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { RuleForm } from "@/components/rule-form";

export const Route = createFileRoute("/rules/new")({
  component: NewRulePage,
});

function NewRulePage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Link
        to="/rules"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Rules
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">New rule</h1>
      <RuleForm />
    </div>
  );
}
