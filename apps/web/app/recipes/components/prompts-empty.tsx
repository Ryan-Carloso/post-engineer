//---------------
// PromptsEmpty — shown when search and filter match nothing.
//---------------

export default function PromptsEmpty({ message }: { message: string }) {
  return (
    <p className="rounded-2xl border border-dashed border-[#e3e8ef] bg-white px-6 py-12 text-center text-[#718096]">
      {message}
    </p>
  );
}
