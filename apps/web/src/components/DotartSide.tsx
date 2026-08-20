type DotartSideProps = {
  className?: string;
};

export const DotartSide = ({ className }: DotartSideProps) => {
  return <div className={className} aria-hidden="true" />;
};