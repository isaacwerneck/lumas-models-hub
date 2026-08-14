import { useEffect, useState } from "react";

type DotartSideProps = {
  className?: string;
};

export const DotartSide = ({ className }: DotartSideProps) => {
  const [dotart, setDotart] = useState("");
  const tiledDotart = dotart ? `${dotart}\n${dotart}\n${dotart}` : "";

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/assets/dotarts.txt");
        if (!response.ok) {
          throw new Error("dotart not found");
        }
        const text = await response.text();
        setDotart(text);
      } catch {
        setDotart("");
      }
    })();
  }, []);

  return (
    <div className={className} aria-hidden="true" data-dotart-loaded={dotart ? "true" : "false"}>
      <pre className="dotart-text">{tiledDotart}</pre>
    </div>
  );
};
