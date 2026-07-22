GRANT EXECUTE ON FUNCTION public.is_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manages_user(uuid, uuid) TO authenticated;