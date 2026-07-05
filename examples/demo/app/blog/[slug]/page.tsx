export default function Page({ params }: { params: { slug: string } }) {
  return <article>Post: {params.slug}</article>;
}
