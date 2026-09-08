/**
 * Categories admin page (spec 4, ticket #87): the tree (Category ->
 * Subcategory -> Subsubcategory) with both Locale names next to each node,
 * an add form per level under each parent, inline rename forms per Locale,
 * and a delete button per node. Reads through
 * src/repository/admin/categories.ts's loadCategoryTree (server component);
 * every write is a Client Component form bound to a Server Action in
 * ./actions.ts (see ./forms.tsx's docblock for why those need to be Client
 * Components).
 */
import { getTranslations } from "next-intl/server";
import { resolveLocalStackConfig } from "@/repository";
import {
  createCategoriesAdminRepository,
  type CategoryNode,
  type SubcategoryNode,
  type SubsubcategoryNode,
} from "@/repository/admin/categories";
import { AddNodeForm, DeleteNodeForm, RenameNodeForm } from "./forms";

function NodeNames({ nl, en }: { nl: string; en: string }) {
  return (
    <span className="font-medium">
      {nl} <span className="text-gray-500">/ {en}</span>
    </span>
  );
}

function SubsubcategoryRow({ node }: { node: SubsubcategoryNode }) {
  return (
    <li className="ml-8 flex flex-wrap items-center gap-3 border-b py-1">
      <NodeNames nl={node.names.nl} en={node.names.en} />
      <RenameNodeForm level="subsubcategory" id={node.id} locale="nl" initialName={node.names.nl} />
      <RenameNodeForm level="subsubcategory" id={node.id} locale="en" initialName={node.names.en} />
      <DeleteNodeForm level="subsubcategory" id={node.id} />
    </li>
  );
}

function SubcategoryBlock({ node }: { node: SubcategoryNode }) {
  return (
    <li className="ml-4 border-b py-2">
      <div className="flex flex-wrap items-center gap-3">
        <NodeNames nl={node.names.nl} en={node.names.en} />
        <RenameNodeForm level="subcategory" id={node.id} locale="nl" initialName={node.names.nl} />
        <RenameNodeForm level="subcategory" id={node.id} locale="en" initialName={node.names.en} />
        <DeleteNodeForm level="subcategory" id={node.id} />
      </div>
      <ul className="mt-1">
        {node.subsubcategories.map((subsub) => (
          <SubsubcategoryRow key={subsub.id} node={subsub} />
        ))}
      </ul>
      <div className="ml-8 mt-1">
        <AddNodeForm level="subsubcategory" parentId={node.id} />
      </div>
    </li>
  );
}

function CategoryBlock({ node }: { node: CategoryNode }) {
  return (
    <li className="border-b py-3">
      <div className="flex flex-wrap items-center gap-3">
        <NodeNames nl={node.names.nl} en={node.names.en} />
        <RenameNodeForm level="category" id={node.id} locale="nl" initialName={node.names.nl} />
        <RenameNodeForm level="category" id={node.id} locale="en" initialName={node.names.en} />
        <DeleteNodeForm level="category" id={node.id} />
      </div>
      <ul className="mt-2">
        {node.subcategories.map((subcategory) => (
          <SubcategoryBlock key={subcategory.id} node={subcategory} />
        ))}
      </ul>
      <div className="ml-4 mt-1">
        <AddNodeForm level="subcategory" parentId={node.id} />
      </div>
    </li>
  );
}

export default async function CategoriesPage() {
  const t = await getTranslations("categories");
  const repository = createCategoriesAdminRepository(resolveLocalStackConfig());
  const tree = await repository.loadCategoryTree();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <ul>
        {tree.map((category) => (
          <CategoryBlock key={category.id} node={category} />
        ))}
      </ul>
      <div>
        <h2 className="font-medium">{t("form.add.category")}</h2>
        <AddNodeForm level="category" parentId={null} />
      </div>
    </div>
  );
}
