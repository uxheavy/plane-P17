import { ListSearchInput } from "@/components/core/list";

type Props = {
  searchQuery: string;
  updateSearchQuery: (value: string) => void;
};

export function PageSearchInput(props: Props) {
  return <ListSearchInput {...props} placeholder="Search pages" />;
}
